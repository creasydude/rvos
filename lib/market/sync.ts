// EOD ETL orchestration (Option A). Pulls TSETMC technical/flow data and Codal
// filings into the app's SQLite DB via idempotent upserts. Also downloads Codal
// financial-statement PDFs into data/filings/ and records them in statement_docs
// so the PDF parser (lib/market/parse.ts) can turn them into line items later.

import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { ensureMarketSchema } from "./schema";
import {
  searchInstrument,
  getInstrumentInfo,
  getClosingPriceDailyList,
  getPriceAdjustList,
  getShareChange,
  getClientTypeHistory,
  TseQuote,
  TseBar,
  TseAdjust,
  TseShare,
  TseClientFlow,
} from "./tsetmc";
import {
  searchLetters,
  downloadPdf,
  downloadExcel,
  downloadLetterHtml,
  pdfUrl,
  excelUrl,
  CODAL_PAGE_SIZE,
  type CodalLetter,
} from "./codal";
import { parseAndLoadStatements, extractPdfText, htmlToText } from "./parse";
import {
  periodEndFromTitle,
  jalaliYear,
  faDigits,
  persianDateTimeToEpoch,
  daysAgoJalali,
  todayJalali,
} from "./jalaali";

ensureMarketSchema();

const DATA_DIR = process.env.RVOS_DATA_DIR || path.join(process.cwd(), "data");
const FILINGS_DIR = path.join(DATA_DIR, "filings");

function tx(fn: () => void) {
  db.exec("BEGIN");
  try {
    fn();
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

// ---- instrument resolution ---------------------------------------------------

export async function resolveInsCode(symbolOrCode: string): Promise<string | null> {
  const s = symbolOrCode.trim();
  if (/^\d{10,}$/.test(s)) return s;
  const hits = await searchInstrument(s);
  if (!hits.length) return null;
  const exact = hits.find((h) => h.lVal18AFC === s);
  return (exact ?? hits[0]).insCode ?? null;
}

// ---- per-symbol Cotal financial-statement sync ------------------------------
//
// The Cotal search API filters by symbol server-side via the `Symbol=` param
// (verified live: Symbol=فولاد → all results carry that ticker). We pass it so
// a symbol's own statements are reachable in a few pages instead of being buried
// in the global publish-date feed. The feed is ordered by publish date desc, and
// statements for the current reporting season appear within the first handful of
// pages (verified live: غالبر's audited FY1404 statements on pages 2-7 of a
// ~160-day window). Prior-year statements are searched in an earlier window and
// only when the current season didn't already yield the most recent fiscal year,
// so the common case stays fast.

/** Strip ZWNJ/ZWNJ-like marks and collapse spaces so the title match is stable. */
function normTitle(s: string): string {
  return s.replace(/[‌‏]/g, "").replace(/\s+/g, " ").trim();
}

const STMT_TITLE_RE = /صورت\s*های?\s*مالی|صورت\s*مالی|اطلاعات\s*و\s*صورت|گزارش\s*تفسیری/i;
const NOT_STMT_TITLE_RE = /دعوت به مجمع|خلاصه تصمیمات|تصمیمات مجمع|افشای اطلاعات|گزارش هیئت مدیره|آگهی|مزایده|پورتفوی/i;

/** A letter is a real periodic financial statement only when its title says so AND carries a report period. */
function isStatementLetter(l: CodalLetter): boolean {
  const t = normTitle(l.Title ?? "");
  if (!t) return false;
  if (NOT_STMT_TITLE_RE.test(t)) return false;
  if (!STMT_TITLE_RE.test(t)) return false;
  return periodEndFromTitle(t) != null;
}

/** For the same period_end, prefer Excel (clean parse) > consolidated > audited > parent (not a subsidiary). */
function isBetterStatement(a: CodalLetter, b: CodalLetter): boolean {
  const ax = a.HasExcel ? 1 : 0;
  const bx = b.HasExcel ? 1 : 0;
  if (ax !== bx) return ax > bx;
  const at = (a.Title ?? ""), bt = (b.Title ?? "");
  const aCons = /تلفیقی/.test(at), bCons = /تلفیقی/.test(bt);
  if (aCons !== bCons) return aCons;
  const aAud = /حسابرسی شده/.test(at), bAud = /حسابرسی شده/.test(bt);
  if (aAud !== bAud) return aAud;
  const aSub = /\(شرکت/.test(at), bSub = /\(شرکت/.test(bt);
  if (aSub !== bSub) return !aSub;
  return (a.TracingNo ?? 0) > (b.TracingNo ?? 0);
}

/**
 * Search the 12-month periodic-statement feed for ALL of a symbol's statements
 * inside a publish window. Returns one (best) letter per distinct period_end.
 */
export async function findStatementLetters(
  symbol: string,
  opts?: { fromDate?: string; toDate?: string; maxPages?: number },
): Promise<CodalLetter[]> {
  const fromDate = opts?.fromDate ?? daysAgoJalali(160);
  const toDate = opts?.toDate ?? daysAgoJalali(0);
  const maxPages = opts?.maxPages ?? 12;
  const byPeriod = new Map<string, CodalLetter>();
  for (let page = 1; page <= maxPages; page++) {
    const r = await searchLetters({ symbol, letterType: 6, period: 12, fromDate, toDate, page });
    if (!r.letters.length) break;
    for (const l of r.letters) {
      if (!isStatementLetter(l)) continue;
      const pe = periodEndFromTitle(l.Title ?? "");
      const key = pe ?? `x${l.TracingNo ?? 0}`;
      const cur = byPeriod.get(key);
      if (!cur || isBetterStatement(l, cur)) byPeriod.set(key, l);
    }
    if (r.letters.length < CODAL_PAGE_SIZE) break;
  }
  return [...byPeriod.values()];
}

export type FundamentalSyncResult = {
  ok: boolean;
  insCode?: string;
  symbol?: string;
  statements?: number; // distinct statement docs persisted
  items?: number; // parsed metric line items in `fundamentals`
  reason?: string;
};

/**
 * Pull a symbol's periodic financial statements from Cotal, file the PDF/Excel
 * back into statement_docs and parse them into `fundamentals` line items.
 * Best-effort: never throws; parse failures surface in the counts.
 */
export async function syncCodalForSymbol(
  symbolOrCode: string,
  opts?: { download?: boolean; maxPages?: number; years?: 1 | 2; symbol?: string },
): Promise<FundamentalSyncResult> {
  const download = opts?.download ?? true;
  const maxPages = opts?.maxPages ?? 12;
  const years = opts?.years ?? 2;

  const insCode = await resolveInsCode(symbolOrCode);
  if (!insCode) return { ok: false, reason: "instrument not found" };

  let symbol = opts?.symbol ?? symbolOrCode;
  if (!opts?.symbol) {
    try {
      const q = await getInstrumentInfo(insCode);
      if (q?.lVal18AFC) symbol = q.lVal18AFC;
    } catch (e) {
      console.error("[sync] instrument info failed", insCode, (e as Error).message);
    }
  }

  const toDate = daysAgoJalali(0);
  // Window 1: the current reporting season (statements published in the last
  // ~160 days, covering the year that ended last winter). Window 2: one season
  // earlier — scanned only when window 1 didn't already yield the most recent
  // fiscal year's statement, so the common case stays fast.
  const seen = new Map<string, CodalLetter>();
  const scanWindow = async (from: string, till: string) => {
    let hits: CodalLetter[] = [];
    try {
      hits = await findStatementLetters(symbol, { fromDate: from, toDate: till, maxPages });
    } catch (e) {
      console.error("[sync] codal statement search failed", symbol, (e as Error).message);
    }
    for (const l of hits) {
      const pe = periodEndFromTitle(l.Title ?? "");
      const key = pe ?? `x${l.TracingNo ?? 0}`;
      const cur = seen.get(key);
      if (!cur || isBetterStatement(l, cur)) seen.set(key, l);
    }
  };

  await scanWindow(daysAgoJalali(160), toDate);
  if (years === 2) {
    const latestPe = [...seen.values()].map((l) => periodEndFromTitle(l.Title ?? ""));
    const hasRecent = latestPe.some((pe) => (pe ? jalaliYear(pe) >= todayJalali().jy - 1 : false));
    if (!hasRecent) await scanWindow(daysAgoJalali(540), daysAgoJalali(160));
  }

  const selected = [...seen.values()].sort((a, b) => {
    const pa = periodEndFromTitle(a.Title ?? "") ?? "";
    const pb = periodEndFromTitle(b.Title ?? "") ?? "";
    return pb.localeCompare(pa);
  });

  if (!selected.length) {
    return { ok: true, insCode, symbol, statements: 0, items: 0, reason: "no periodic statements in window" };
  }

  if (!fs.existsSync(FILINGS_DIR)) fs.mkdirSync(FILINGS_DIR);
  let statements = 0;
  for (const l of selected) {
    const periodEnd = periodEndFromTitle(l.Title ?? "");
    if (!periodEnd) continue;
    upsertLetter(l);
    let pdfPath: string | null = null;
    let rawText: string | null = null;
    if (download && l.HasPdf && pdfUrl(l)) {
      try {
        const buf = await downloadPdf(pdfUrl(l)!);
        // Codal sometimes returns HTTP 200 with an error page rendered as PDF
        // (1-page file containing just "ERROR"). Validate the header and content.
        const header = new Uint8Array(buf.slice(0, 5));
        const isPdf = header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46; // %PDF
        if (!isPdf) {
          console.warn("[sync] skipping non-PDF response for", l.TracingNo);
        } else {
          const text = await extractPdfText(buf).catch(() => null);
          // If the only text is "ERROR" or similarly useless, Codal served an error page.
          const trimmed = (text ?? "").replace(/\s+/g, " ").trim();
          if (trimmed.length < 20 || /^ERROR$/i.test(trimmed)) {
            console.warn("[sync] skipping error-page PDF for", l.TracingNo, "— content:", trimmed.slice(0, 60));
          } else {
            const file = path.join(FILINGS_DIR, `${l.TracingNo}.pdf`);
            fs.writeFileSync(file, Buffer.from(buf));
            pdfPath = file;
            rawText = text;
          }
        }
      } catch (e) {
        console.error("[sync] statement pdf download failed", l.TracingNo, (e as Error).message);
      }
    }
    upsertStatementDoc(l, pdfPath, periodEnd, insCode, rawText);
    statements++;
  }

  let items = 0;
  if (statements) {
    try {
      const p = await parseAndLoadStatements(insCode);
      items = p.items;
    } catch (e) {
      console.error("[sync] statement parse failed", insCode, (e as Error).message);
    }
  }
  return { ok: true, insCode, symbol, statements, items };
}

// ---- important statements -----------------------------------------------------
//
// Beyond the periodic financial statements above, a symbol's other important
// Codal disclosures carry the most qualitative signal for an LLM: interpretive
// management reports (گزارش تفسیری مدیریت), board reports (گزارش هیئت مدیره),
// earnings forecasts (پیش‌بینی سود هر سهم) and material disclosures (افشای
// اطلاعات با اهمیت). The periodic-statement path filters these OUT on purpose;
// this path pulls them in, downloads the PDF/Excel, extracts the full text and
// files it in `codal_reports` so the fundamental-context loader can hand the
// LLM real statement content — not just computed ratios.
//
// To add a new kind, add an entry to REPORT_KINDS and (optionally) a surface in
// lib/market/context.ts. This classification set is the one configurable knob.

const YE = "ي"; // Arabic Yeh (canonical) — normalize Persian/Arabic variants to it

/** Strip ZWNJ + collapse whitespace AND normalize Yeh variants for stable regex. */
function normPersian(s: string): string {
  return normTitle(s).replace(/[یى]/g, YE);
}

export type ReportKind = "interpretive" | "board" | "forecast" | "disclosure";

const REPORT_KINDS: { kind: ReportKind; re: RegExp }[] = [
  { kind: "interpretive", re: /گزارش\s*تفسير/ },
  { kind: "board", re: /گزارش\s*(فعاليت\s*)?هي(ئ|ا)ت\s*مدير/ },
  { kind: "forecast", re: /پيش\s*بين\s*سود|برآورد\s*سود|سود\s*و\s*زيان\s*پيش/ },
  { kind: "disclosure", re: /افشاي\s*اطلاعات\s*با\s*اهميت|گزارش\s*توجيه/ },
];

/** Titles that share keywords with reports but are not fundamental material. */
const REPORT_NOISE_RE =
  /دعوت\s*به\s*مجمع|آگهي|مزاي[د]ه|اساسنامه|پورتفو|فهرست\s*دريافت|اوراق\s*مشارکت|پذيره\s*نويس|دارايي\s*هاي\s*غير\s*جاري\s*در\s*تملک/;

/** Min chars an HTML-letter body must have to be stored as report text. The Codal
 * Attachment.aspx page shell is ~230 chars of chrome (ضمائم / a log line) when
 * the real body is JS-rendered — reject that so a text-less report stays text-less
 * (honest) instead of polluting the LLM context with boilerplate. */
const MIN_HTML_BODY = 400;

/**
 * Classify a Codal letter title into an important-statement kind, or null when
 * the letter is not one we track (noise, or not one of the four kinds).
 */
export function classifyReportKind(title: string | null | undefined): ReportKind | null {
  const t = normPersian(title ?? "");
  if (!t) return null;
  if (REPORT_NOISE_RE.test(t)) return null;
  for (const r of REPORT_KINDS) if (r.re.test(t)) return r.kind;
  return null;
}

/**
 * Search the Codal feed for a symbol's important statements. One symbol-scoped
 * all-letter sweep (letterType -1) over a ~370-day window: with the server-side
 * Symbol= filter a whole year is only a handful of pages (verified live: فولاد
 * 197 letters/10 pages, غالبر 96/5), and the qualitative reports live in the
 * general feed rather than the periodic-statement feed (letterType 6) that
 * findStatementLetters already covers. Returns every matching letter (classified,
 * deduped by TracingNo) — unlike findStatementLetters, we keep ALL of them, since
 * each report is distinct.
 */
export async function findImportantLetters(
  symbol: string,
  opts?: { fromDate?: string; toDate?: string; maxPages?: number },
): Promise<{ letter: CodalLetter; kind: ReportKind }[]> {
  const fromDate = opts?.fromDate ?? daysAgoJalali(370);
  const toDate = opts?.toDate ?? daysAgoJalali(0);
  const maxPages = opts?.maxPages ?? 12;
  const out = new Map<number, { letter: CodalLetter; kind: ReportKind }>();
  for (let page = 1; page <= maxPages; page++) {
    const r = await searchLetters({ symbol, letterType: -1, period: -1, fromDate, toDate, page });
    if (!r.letters.length) break;
    for (const l of r.letters) {
      if (!l.TracingNo || out.has(l.TracingNo)) continue;
      const kind = classifyReportKind(l.Title);
      if (kind) out.set(l.TracingNo, { letter: l, kind });
    }
    if (r.letters.length < CODAL_PAGE_SIZE) break;
  }
  return [...out.values()];
}

export type ImportantStatementsResult = {
  ok: boolean;
  insCode?: string;
  symbol?: string;
  reports?: number; // newly stored this run
  total?: number; // all tracked reports for the symbol
  reason?: string;
};

/**
 * Pull a symbol's important statements (interpretive/board/forecast/disclosure),
 * download and extract their text, and file them in `codal_reports`. Best-effort:
 * never throws; a throttled search or failed PDF surfaces in the counts.
 */
export async function syncImportantStatements(
  symbolOrCode: string,
  opts?: { symbol?: string; download?: boolean; maxPages?: number },
): Promise<ImportantStatementsResult> {
  const download = opts?.download ?? true;
  const insCode = await resolveInsCode(symbolOrCode);
  if (!insCode) return { ok: false, reason: "instrument not found" };

  let symbol = opts?.symbol ?? symbolOrCode;
  if (!opts?.symbol) {
    try {
      const q = await getInstrumentInfo(insCode);
      if (q?.lVal18AFC) symbol = q.lVal18AFC;
    } catch (e) {
      console.error("[sync] instrument info failed", insCode, (e as Error).message);
    }
  }

  let found: { letter: CodalLetter; kind: ReportKind }[] = [];
  try {
    found = await findImportantLetters(symbol, { maxPages: opts?.maxPages });
  } catch (e) {
    console.error("[sync] important statement search failed", symbol, (e as Error).message);
  }

  if (!fs.existsSync(FILINGS_DIR)) fs.mkdirSync(FILINGS_DIR);
  const fetchBody = async (l: CodalLetter): Promise<{ pdfPath: string | null; rawText: string | null }> => {
    let pdfPath: string | null = null;
    let rawText: string | null = null;
    if (download && l.HasPdf && pdfUrl(l)) {
      try {
        const buf = await downloadPdf(pdfUrl(l)!);
        // Validate: Codal sometimes returns HTTP 200 with an error page as PDF.
        const header = new Uint8Array(buf.slice(0, 5));
        const isPdf = header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46;
        if (!isPdf) {
          console.warn("[sync] skipping non-PDF response for report", l.TracingNo);
        } else {
          const text = await extractPdfText(Buffer.from(buf)).catch(() => null);
          const trimmed = (text ?? "").replace(/\s+/g, " ").trim();
          if (trimmed.length < 20 || /^ERROR$/i.test(trimmed)) {
            console.warn("[sync] skipping error-page PDF for report", l.TracingNo);
          } else {
            const file = path.join(FILINGS_DIR, `${l.TracingNo}.pdf`);
            fs.writeFileSync(file, Buffer.from(buf));
            pdfPath = file;
            rawText = text;
          }
        }
      } catch (e) {
        console.error("[sync] important report pdf download/extract failed", l.TracingNo, (e as Error).message);
      }
    }
    if (rawText == null && l.HasExcel && excelUrl(l)) {
      try {
        rawText = htmlToText(await downloadExcel(excelUrl(l)!));
      } catch (e) {
        console.error("[sync] important report excel text failed", l.TracingNo, (e as Error).message);
      }
    }
    // Attachment-less reports (e.g. board reports) render their body on the Codal
    // detail page — pull it so the report still contributes text to the LLM. The
    // page shell carries ~40 chars of chrome (ضمائم / a JS line / a log entry)
    // when the real body is JS-rendered, so accept the extraction only when it
    // holds substantive text — otherwise leave the report text-less (honest: we
    // don't have the content) rather than store chrome as if it were content.
    if (rawText == null && l.Url) {
      try {
        const t = htmlToText(await downloadLetterHtml(l));
        if (t.trim().length >= MIN_HTML_BODY) rawText = t;
      } catch (e) {
        console.error("[sync] important report html body failed", l.TracingNo, (e as Error).message);
      }
    }
    return { pdfPath, rawText };
  };

  let stored = 0;
  for (const { letter: l, kind } of found) {
    if (!l.TracingNo) continue;
    // Keep the letter metadata (Url, HasHtml…) so we know what we saved and could
    // refetch the body later. codal_letters also feeds the UI's letter history.
    upsertLetter(l);
    const existing = db.prepare("SELECT raw_text, pdf_path FROM codal_reports WHERE tracing_no = ?").get(l.TracingNo) as
      | { raw_text: string | null; pdf_path: string | null }
      | undefined;
    if (existing) {
      // Refresh metadata; if a previous sync stored the report without any text
      // (extraction failed, or it was filed before the HTML-body fallback), try
      // once more to recover the body — keeping the pdf_path we already have.
      if (existing.raw_text == null || existing.raw_text.length === 0) {
        const { rawText } = await fetchBody(l);
        upsertReport(l, kind, existing.pdf_path, rawText, insCode);
      } else {
        upsertReport(l, kind, null, null, insCode);
      }
      continue;
    }
    const { pdfPath, rawText } = await fetchBody(l);
    upsertReport(l, kind, pdfPath, rawText, insCode);
    stored++;
  }

  const totalRow = db.prepare("SELECT COUNT(*) AS n FROM codal_reports WHERE ins_code = ?").get(insCode) as { n: number } | undefined;
  return { ok: true, insCode, symbol, reports: stored, total: Number(totalRow?.n ?? 0) };
}

// ---- upsert helpers ----------------------------------------------------------

function upsertInstrument(insCode: string, q: TseQuote) {
  const eps = q.eps ?? {};
  const estEps =
    typeof eps.estimatedEPS === "number"
      ? eps.estimatedEPS
      : typeof eps.estimatedEPS === "string"
        ? Number(faDigits(eps.estimatedEPS)) || null
        : null;
  const lastPrice = typeof q.pDrCotVal === "number" ? q.pDrCotVal : null;
  const open = q.yVal ? Number(faDigits(String(q.yVal))) || null : null;
  db.prepare(
    `INSERT INTO instruments
      (ins_code, symbol, name, lval18, c_isin, market, sector, sector_code,
       shares_outstanding, base_vol, est_eps, sector_pe, psr, last_price, open,
       price_min, price_max, flow, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(ins_code) DO UPDATE SET
       symbol=excluded.symbol, name=excluded.name, lval18=excluded.lval18,
       c_isin=excluded.c_isin, market=excluded.market, sector=excluded.sector,
       sector_code=excluded.sector_code, shares_outstanding=excluded.shares_outstanding,
       base_vol=excluded.base_vol, est_eps=excluded.est_eps, sector_pe=excluded.sector_pe,
       psr=excluded.psr, last_price=excluded.last_price, open=excluded.open,
       price_min=excluded.price_min, price_max=excluded.price_max, flow=excluded.flow,
       updated_at=excluded.updated_at`,
  ).run(
    insCode,
    q.lVal18AFC ?? null,
    q.lVal30 ?? null,
    q.lVal18 ?? null,
    q.cIsin ?? null,
    q.flowTitle ?? null,
    q.sector?.lSecVal ?? null,
    q.sector?.cSecVal ?? null,
    typeof q.zTitad === "number" ? q.zTitad : null,
    typeof q.baseVol === "number" ? q.baseVol : null,
    estEps,
    typeof eps.sectorPE === "number" ? eps.sectorPE : null,
    typeof eps.psr === "number" ? eps.psr : null,
    lastPrice,
    open,
    typeof q.priceMin === "number" ? q.priceMin : null,
    typeof q.priceMax === "number" ? q.priceMax : null,
    q.flow ?? null,
    Date.now(),
  );
}

function upsertQuote(insCode: string, q: TseQuote) {
  const last = typeof q.last === "number" ? q.last : typeof q.pDrCotVal === "number" ? q.pDrCotVal : null;
  const open = q.yVal ? Number(faDigits(String(q.yVal))) || null : null;
  db.prepare(
    `INSERT INTO quotes_snapshot
       (ins_code, last, open, high, low, volume, value, trades, price_change, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(ins_code) DO UPDATE SET
       last=excluded.last, open=excluded.open, high=excluded.high, low=excluded.low,
       volume=excluded.volume, value=excluded.value, trades=excluded.trades,
       price_change=excluded.price_change, updated_at=excluded.updated_at`,
  ).run(
    insCode,
    last,
    open,
    typeof q.priceMin === "number" ? q.priceMin : null,
    typeof q.priceMax === "number" ? q.priceMax : null,
    typeof q.qTotTran5J === "number" ? q.qTotTran5J : null,
    typeof q.qTotCap === "number" ? q.qTotCap : null,
    null,
    typeof q.priceChange === "number" ? q.priceChange : null,
    Date.now(),
  );
}

function upsertBars(insCode: string, bars: TseBar[]) {
  const stmt = db.prepare(
    `INSERT INTO daily_bars
       (ins_code, d_even, h_even, open, high, low, close, last, price_change,
        volume, value, trades)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(ins_code, d_even) DO UPDATE SET
       h_even=excluded.h_even, open=excluded.open, high=excluded.high, low=excluded.low,
       close=excluded.close, last=excluded.last, price_change=excluded.price_change,
       volume=excluded.volume, value=excluded.value, trades=excluded.trades`,
  );
  tx(() => {
    for (const b of bars) {
      stmt.run(
        insCode,
        b.dEven ?? 0,
        b.hEven ?? null,
        b.priceFirst ?? null,
        b.priceMax ?? null,
        b.priceMin ?? null,
        b.pClosing ?? null,
        b.pDrCotVal ?? null,
        b.priceChange ?? null,
        b.zTotTran ?? null,
        b.qTotCap ?? null,
        b.qTotTran5J ?? null,
      );
    }
  });
}

function upsertAdjusts(insCode: string, adj: TseAdjust[]) {
  const stmt = db.prepare(
    `INSERT INTO price_adjustments (ins_code, d_even, p_closing, p_closing_not_adjusted)
     VALUES (?,?,?,?)
     ON CONFLICT(ins_code, d_even) DO UPDATE SET
       p_closing=excluded.p_closing, p_closing_not_adjusted=excluded.p_closing_not_adjusted`,
  );
  tx(() => {
    for (const a of adj) {
      stmt.run(insCode, a.dEven ?? 0, a.pClosing ?? null, a.pClosingNotAdjusted ?? null);
    }
  });
}

function upsertShares(insCode: string, rows: TseShare[]) {
  const stmt = db.prepare(
    `INSERT INTO share_changes (ins_code, d_even, new_shares, old_shares)
     VALUES (?,?,?,?)
     ON CONFLICT(ins_code, d_even) DO UPDATE SET
       new_shares=excluded.new_shares, old_shares=excluded.old_shares`,
  );
  tx(() => {
    for (const r of rows) {
      stmt.run(insCode, r.dEven ?? 0, r.numberOfShareNew ?? null, r.numberOfShareOld ?? null);
    }
  });
}

function upsertFlows(insCode: string, rows: TseClientFlow[]) {
  const stmt = db.prepare(
    `INSERT INTO client_flows
       (ins_code, rec_date, buy_i_vol, buy_n_vol, buy_i_val, buy_n_val, buy_i_count,
        buy_n_count, sell_i_vol, sell_n_vol, sell_i_val, sell_n_val, sell_i_count,
        sell_n_count)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(ins_code, rec_date) DO UPDATE SET
       buy_i_vol=excluded.buy_i_vol, buy_n_vol=excluded.buy_n_vol,
       buy_i_val=excluded.buy_i_val, buy_n_val=excluded.buy_n_val,
       buy_i_count=excluded.buy_i_count, buy_n_count=excluded.buy_n_count,
       sell_i_vol=excluded.sell_i_vol, sell_n_vol=excluded.sell_n_vol,
       sell_i_val=excluded.sell_i_val, sell_n_val=excluded.sell_n_val,
       sell_i_count=excluded.sell_i_count, sell_n_count=excluded.sell_n_count`,
  );
  tx(() => {
    for (const r of rows) {
      stmt.run(
        insCode,
        r.recDate ?? 0,
        r.buy_I_Volume ?? null,
        r.buy_N_Volume ?? null,
        r.buy_I_Value ?? null,
        r.buy_N_Value ?? null,
        r.buy_I_Count ?? null,
        r.buy_N_Count ?? null,
        r.sell_I_Volume ?? null,
        r.sell_N_Volume ?? null,
        r.sell_I_Value ?? null,
        r.sell_N_Value ?? null,
        r.sell_I_Count ?? null,
        r.sell_N_Count ?? null,
      );
    }
  });
}

function upsertLetter(l: CodalLetter) {
  const serial = (l.Url ?? "").match(/LetterSerial=([^&]+)/)?.[1] ?? null;
  db.prepare(
    `INSERT INTO codal_letters
       (tracing_no, symbol, company_name, letter_code, title, letter_type, sent_at,
        published_at, has_pdf, has_excel, has_html, has_xbrl, serial, url, fetched_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(tracing_no) DO UPDATE SET
       symbol=excluded.symbol, company_name=excluded.company_name,
       letter_code=excluded.letter_code, title=excluded.title, letter_type=excluded.letter_type,
       sent_at=excluded.sent_at, published_at=excluded.published_at,
       has_pdf=excluded.has_pdf, has_excel=excluded.has_excel, has_html=excluded.has_html,
       has_xbrl=excluded.has_xbrl, serial=excluded.serial, url=excluded.url,
       fetched_at=excluded.fetched_at`,
  ).run(
    l.TracingNo ?? 0,
    l.Symbol ?? null,
    l.CompanyName ?? null,
    l.LetterCode ?? null,
    l.Title ?? null,
    null, // letter_type — not returned by search v2/q
    l.SentDateTime ?? null,
    persianDateTimeToEpoch(l.PublishDateTime),
    l.HasPdf ? 1 : 0,
    l.HasExcel ? 1 : 0,
    l.HasHtml ? 1 : 0,
    l.HasXbrl ? 1 : 0,
    serial,
    l.Url ?? null,
    Date.now(),
  );
}

function upsertStatementDoc(l: CodalLetter, pdfPath: string | null, periodEnd: string | null, insCode: string | null, rawText?: string | null) {
  const fy = periodEnd ? jalaliYear(periodEnd) : 0;
  const exUrl = l.ExcelUrl ?? null;
  db.prepare(
    `INSERT INTO statement_docs
       (tracing_no, ins_code, symbol, letter_code, title, period_end, fy, pdf_path, excel_url, raw_text, parsed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(tracing_no) DO UPDATE SET
       ins_code=excluded.ins_code, symbol=excluded.symbol, letter_code=excluded.letter_code,
       title=excluded.title, period_end=excluded.period_end, fy=excluded.fy,
       pdf_path=excluded.pdf_path, excel_url=excluded.excel_url,
       raw_text=COALESCE(excluded.raw_text, statement_docs.raw_text), parsed_at=excluded.parsed_at`,
  ).run(l.TracingNo ?? 0, insCode, l.Symbol ?? null, l.LetterCode ?? null, l.Title ?? null, periodEnd, fy || null, pdfPath, exUrl, rawText ?? null, null);
}

function upsertReport(l: CodalLetter, kind: ReportKind | null, pdfPath: string | null, rawText: string | null, insCode: string | null) {
  const periodEnd = periodEndFromTitle(l.Title ?? "");
  const fy = periodEnd ? jalaliYear(periodEnd) : 0;
  db.prepare(
    `INSERT INTO codal_reports
       (tracing_no, ins_code, symbol, company_name, title, letter_code, letter_type,
        kind, period_end, fy, sent_at, published_at, pdf_path, raw_text, fetched_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(tracing_no) DO UPDATE SET
       ins_code=excluded.ins_code, symbol=excluded.symbol, company_name=excluded.company_name,
       title=excluded.title, letter_code=excluded.letter_code, kind=excluded.kind,
       period_end=excluded.period_end, fy=excluded.fy, sent_at=excluded.sent_at,
       published_at=excluded.published_at, pdf_path=excluded.pdf_path,
       raw_text=COALESCE(excluded.raw_text, codal_reports.raw_text), fetched_at=excluded.fetched_at`,
  ).run(
    l.TracingNo ?? 0,
    insCode,
    l.Symbol ?? null,
    l.CompanyName ?? null,
    l.Title ?? null,
    l.LetterCode ?? null,
    null, // letter_type — not returned by search v2/q
    kind,
    periodEnd,
    fy || null,
    l.SentDateTime ?? null,
    persianDateTimeToEpoch(l.PublishDateTime),
    pdfPath,
    rawText,
    Date.now(),
  );
}

// ---- public sync entry points -------------------------------------------------

export type SyncResult = {
  ok: boolean;
  insCode?: string;
  symbol?: string;
  reason?: string;
  bars?: number;
  adjusts?: number;
  shares?: number;
  flows?: number;
  statements?: number; // distinct financial-statement docs persisted from Cotal
  fundamentalItems?: number; // parsed line items in `fundamentals`
  reports?: number; // important statements (interpretive/board/forecast/disclosure) stored
};

export async function syncSymbol(symbolOrCode: string): Promise<SyncResult> {
  const insCode = await resolveInsCode(symbolOrCode);
  if (!insCode) return { ok: false, reason: "instrument not found" };
  const quote = await getInstrumentInfo(insCode);
  if (!quote) return { ok: false, reason: "no quote from TSETMC" };
  upsertInstrument(insCode, quote);
  upsertQuote(insCode, quote);
  const bars = await getClosingPriceDailyList(insCode);
  upsertBars(insCode, bars);
  const adj = await getPriceAdjustList(insCode);
  upsertAdjusts(insCode, adj);
  const shares = await getShareChange(insCode);
  upsertShares(insCode, shares);
  const flows = await getClientTypeHistory(insCode);
  upsertFlows(insCode, flows);
  // Pull + parse this symbol's periodic financial statements from Cotal so the
  // fundamental brain gets real line items (loss-makers like غالبر included).
  // Best-effort: sync success does not depend on Cotal being reachable.
  let statements: number | undefined;
  let fundamentalItems: number | undefined;
  try {
    const f = await syncCodalForSymbol(insCode, { symbol: quote.lVal18AFC ?? symbolOrCode });
    statements = f.statements;
    fundamentalItems = f.items;
  } catch (e) {
    console.error("[sync] codal fundamentals sync failed", insCode, (e as Error).message);
  }
  // Important statements (interpretive/board/forecast/disclosure) give the LLM
  // qualitative context on top of the numbers. Best-effort like the codal block.
  let reports: number | undefined;
  try {
    const r = await syncImportantStatements(insCode, { symbol: quote.lVal18AFC ?? symbolOrCode });
    reports = r.reports;
  } catch (e) {
    console.error("[sync] important statements sync failed", insCode, (e as Error).message);
  }
  return {
    ok: true,
    insCode,
    symbol: quote.lVal18AFC ?? symbolOrCode,
    bars: bars.length,
    adjusts: adj.length,
    shares: shares.length,
    flows: flows.length,
    statements,
    fundamentalItems,
    reports,
  };
}

/** A value for the `instruments` table where the code currently lives. */
export function listInstruments(): { symbol: string; insCode: string; name: string | null }[] {
  return (db.prepare("SELECT ins_code, symbol, name FROM instruments ORDER BY symbol").all() as any[]).map((r) => ({
    symbol: r.symbol,
    insCode: r.ins_code,
    name: r.name ?? null,
  }));
}

export async function syncEod(symbols?: string[]): Promise<SyncResult[]> {
  const targets = symbols?.length ? symbols : listInstruments().map((i) => i.insCode ?? i.symbol);
  const out: SyncResult[] = [];
  for (const s of targets) {
    try {
      out.push(await syncSymbol(s));
    } catch (e) {
      out.push({ ok: false, symbol: s, reason: (e as Error).message });
    }
  }
  return out;
}

export async function syncCodalRecent(opts?: {
  letterType?: number;
  days?: number;
  limit?: number;
  period?: number; // reporting period in months (-1 = any); pass 12 to keep annuals only
  download?: boolean;
}): Promise<{ stored: number; downloaded: number }> {
  const days = opts?.days ?? 30;
  const limit = opts?.limit ?? 40;
  const letterType = opts?.letterType ?? -1; // -1 = all
  const period = opts?.period ?? -1; // -1 = any reporting period
  const download = opts?.download ?? true;
  const fromDate = daysAgoJalali(days);
  const toDate = daysAgoJalali(0);
  if (!fs.existsSync(FILINGS_DIR)) fs.mkdirSync(FILINGS_DIR);

  let stored = 0;
  let downloaded = 0;
  for (let page = 1; stored < limit && page <= 200; page++) {
    const { total, letters } = await searchLetters({
      letterType,
      fromDate,
      toDate,
      period,
      page,
    });
    if (!letters.length) break;
    for (const l of letters) {
      if (stored >= limit) break;
      upsertLetter(l);
      stored++;
      // Only actual periodic financial statements (an explicit statement title AND a
      // machine-readable report-period date) belong in statement_docs — AGM/notice
      // letters end up in codal_letters metadata only, so the parse pipeline is not
      // fed meeting minutes.
      const periodEnd = periodEndFromTitle(l.Title ?? "");
      if (!periodEnd || !isStatementLetter(l)) continue;
      if (download && l.HasPdf && l.TracingNo && pdfUrl(l)) {
        try {
          const buf = await downloadPdf(pdfUrl(l)!);
          const file = path.join(FILINGS_DIR, `${l.TracingNo}.pdf`);
          fs.writeFileSync(file, Buffer.from(buf));
          let insCode: string | null = null;
          if (l.Symbol) insCode = await resolveInsCode(l.Symbol).catch(() => null);
          upsertStatementDoc(l, file, periodEnd, insCode);
          downloaded++;
        } catch (e) {
          console.error("pdf download failed for tracing", l.TracingNo, e);
        }
      }
    }
    // Search pages are fixed at CODAL_PAGE_SIZE per page.
    if (page >= Math.ceil(total / CODAL_PAGE_SIZE)) break;
  }
  return { stored, downloaded };
}

/**
 * Parse every instrument that has tracked statement docs into `fundamentals`
 * line items. Call after syncCodalRecent / syncCodalForSymbol so batch and
 * per-symbol flows both leave the DB with parsed statements, not just files.
 */
export async function parseRecordedStatements(): Promise<{ instruments: number; items: number; errors: number }> {
  const rows = (db.prepare("SELECT DISTINCT ins_code FROM statement_docs WHERE ins_code IS NOT NULL").all() as {
    ins_code: string;
  }[]).filter((r) => r.ins_code);
  let instruments = 0;
  let items = 0;
  let errors = 0;
  for (const r of rows) {
    try {
      const p = await parseAndLoadStatements(r.ins_code);
      instruments++;
      items += p.items;
    } catch (e) {
      errors++;
      console.error("[sync] parse recorded statements failed", r.ins_code, (e as Error).message);
    }
  }
  return { instruments, items, errors };
}
// Codal financial-statement → `fundamentals` line items.
//
// Primary: parse Codal's mso-HTML "Excel" attachments (clean numbers, reliable).
// Fallback: PDF positional text extraction (digits scrambled in content stream).
//
// Deps: `pdfjs-dist` (pure JS, no native canvas) — lazy-imported so the sync +
// load pipeline runs even before it's installed.

import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { ensureMarketSchema } from "./schema";
import { METRICS, MetricKey } from "./metrics";
import { faDigits } from "./jalaali";

ensureMarketSchema();

type Pdfjs = {
  getDocument: (src: { data: Uint8Array }) => { promise: Promise<{ numPages: number; getPage: (n: number) => Promise<Page> }> };
};
type Page = {
  getTextContent: () => Promise<{ items: { str?: string; transform?: number[] }[] }>;
};

type Cell = { str: string; x: number };
type Row = { y: number; cells: Cell[] };

/** Labels → metric. Order matters: first matching pattern in a row wins. */
const PATTERNS: { pattern: string; metric: MetricKey; scale: "money" | "per_share"; exclude?: string }[] = [
  { pattern: "جمع دارایی‌ها", metric: METRICS.totalAssets, scale: "money" },
  { pattern: "جمع بدهی‌ها", metric: METRICS.totalLiabilities, scale: "money", exclude: "حقوق" },
  { pattern: "جمع حقوق صاحبان سهام", metric: METRICS.shareholdersEquity, scale: "money" },
  { pattern: "حقوق صاحبان سهام", metric: METRICS.shareholdersEquity, scale: "money", exclude: "جمع بدهی" },
  { pattern: "درآمد عملیاتی", metric: METRICS.revenues, scale: "money" },
  { pattern: "فروش", metric: METRICS.revenues, scale: "money", exclude: "درآمد عملیاتی" },
  { pattern: "بهای تمام شده", metric: METRICS.cogs, scale: "money" },
  { pattern: "سود (زیان) عملیاتی", metric: METRICS.ebit, scale: "money" },
  { pattern: "سود عملیاتی", metric: METRICS.ebit, scale: "money" },
  { pattern: "سود (زیان) قبل از کسر مالیات", metric: METRICS.preTaxIncome, scale: "money" },
  { pattern: "سود قبل از کسر مالیات", metric: METRICS.preTaxIncome, scale: "money" },
  { pattern: "هزینه‌های مالی", metric: METRICS.interestExpense, scale: "money" },
  { pattern: "هزینه های مالی", metric: METRICS.interestExpense, scale: "money" },
  { pattern: "مالیات", metric: METRICS.taxExpense, scale: "money", exclude: "قبل از" },
  { pattern: "سود (زیان) خالص", metric: METRICS.netIncome, scale: "money" },
  { pattern: "سود خالص", metric: METRICS.netIncome, scale: "money" },
  { pattern: "خالص جریان وجوه نقد ناشی از فعالیت‌های عملیاتی", metric: METRICS.operatingCashFlow, scale: "money" },
  { pattern: "خالص جریان وجوه نقد ناشی از فعالیت های عملیاتی", metric: METRICS.operatingCashFlow, scale: "money" },
  { pattern: "سود (زیان) هر سهم", metric: METRICS.eps, scale: "per_share" },
  { pattern: "سود هر سهم", metric: METRICS.eps, scale: "per_share" },
];

/**
 * Detect the unit (Rial multiplier) from a statement's FULL stripped text.
 *
 * Modern Codal statements declare their unit in the body — "کلیه مبالغ درج شده به
 * میلیون ریال" — at positions from ~0.5k to 50k+ chars (bank/insurer header
 * notes sit early, industrial interpretive pages later). Every statement type we
 * see (industrial, bank, holding, interim, insurance) declares میلیون, so the
 * whole text must be scanned; a 5000-char head window misses the declaration and
 * silently defaulted money metrics to هزار (1000× too small).
 *
 * Persian files mix two Yeh codepoints (U+06CC/U+0649 vs U+064A); normalize the
 * haystack to U+064A and build the patterns with the same codepoint so the match
 * is unaffected by whatever variant the filing uses.
 */
function detectUnit(text: string): number {
  const YE = "ي"; // Arabic Yeh, canonical codepoint (U+064A)
  const n = text.replace(/[یى]/g, YE);
  const هزار = "هزار";
  const میلیون = `م${YE}ل${YE}ون`;
  const میلیارد = `م${YE}ل${YE}ارد`;
  const ریال = `ر${YE}ال`;
  const کليه = `کل${YE}ه`; // "کلیه مبالغ … به X ریال" declaration phrase
  // Anchor on the explicit declaration "کلیه مبالغ [درج شده] به X ریال" —
  // a bare "میلیون ریال" also appears as a per-row unit note ("سرمايه - ميليون
  // ريال") in industrial statements, so it must NOT be the trigger. Scan the
  // entire document, not just the head — the declaration position varies by
  // statement type (0.5k-50k+).
  const re = new RegExp(
    `${کليه}\\s*مبالغ[\\s\\S]{0,80}?(هزار|${میلیارد}|${میلیون})\\s*${ریال}`,
  );
  const m = re.exec(n);
  if (m) {
    if (m[1] === هزار) return 1e3;
    if (m[1] === میلیارد) return 1e9;
    return 1e6;
  }
  // No explicit declaration found anywhere. Modern Codal Excel HTML statements
  // (FY1400+) are all in میلیون — default to that rather than the old هزار
  // assumption which was wrong for every statement in the tested corpus.
  return 1e6;
}

/** Parse an amount cell: Persian/latin digits, commas, parentheses = negative. */
function parseAmount(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const neg = s.startsWith("(") || s.endsWith("(") || s.includes(")(") || /^-/.test(s);
  const digits = faDigits(s.replace(/[()\-]/g, ""));
  if (!digits) return null;
  const n = Number(digits);
  if (!isFinite(n)) return null;
  return neg ? -n : n;
}

// ---------------------------------------------------------------------------
// HTML (mso-HTML "Excel") parser — primary extraction method.
// Codal's ExcelUrl returns an mso-HTML file with clean numbers in <td> cells.
// ---------------------------------------------------------------------------

/** Strip HTML tags and decode entities → plain text. */
function htmlText(cell: string): string {
  return cell
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#?\w+;/g, "")
    .trim();
}

/** Parse HTML table rows into string[][] (each row = array of cell texts). */
function parseHtmlTable(html: string): string[][] {
  const rows: string[][] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const tdRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let trMatch: RegExpExecArray | null;
  while ((trMatch = trRe.exec(html)) !== null) {
    const cells: string[] = [];
    let tdMatch: RegExpExecArray | null;
    tdRe.lastIndex = 0;
    while ((tdMatch = tdRe.exec(trMatch[1])) !== null) {
      cells.push(htmlText(tdMatch[1]));
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
}

/**
 * Label-matching rules for the mso-HTML parser.
 * Each rule: regex to match the row label, metric key, and whether it's money.
 * Order matters — more specific patterns first.
 */
const HTML_RULES: { re: RegExp; metric: MetricKey; money: boolean; exclude?: RegExp; grossPremiumOnly?: boolean }[] = [
  // ── Income statement (COGS before revenue so "بهای تمام شده" doesn't match "درآمد" first) ──
  { re: /بهاي?\s*تمام\s*شده/i, metric: METRICS.cogs, money: true },
  // Insurer, income statement: revenue = the earned insurance-income line
  // ("درآمدهای بیمه ای"); exclude the sub-lines (سایر ... ; حق بیمه ناخالص /
  // حق بیمه is premium WRITTEN, which is revenue only in interpretive reports
  // that lack an earned line — see the conditional rule below).
  { re: /درآمد[هاي]*\s*بيمه\s*اي/i, metric: METRICS.revenues, money: true, exclude: /ساير|حق\s*بيمه|سرمایه/ },
  // Insurer interpretive trend tables (گزارش تفسیری, e.g. بیمه ملت) carry no
  // "درآمدهای بیمه ای" earned line — the best top-line proxy is gross premium
  // written ("درآمد حق بيمه ناخالص"). Marked so parseHtml drops it when a real
  // earned-revenue row is present (standard insurers like بیمه دانا).
  { re: /درآمد\s*حق\s*بيمه\s*ناخالص/i, metric: METRICS.revenues, money: true, grossPremiumOnly: true },
  { re: /درآمد[هاي]*\s*عمليات/i, metric: METRICS.revenues, money: true },
  // فروش … sales rows are P&L revenue. Cash-flow proceeds rows ("دریافتهای نقدی
  // حاصل از فروش سهام خزانه", search the .Dana file) are NOT — they'd shadow the
  // real top line because cash-flow rows precede the income statement.
  { re: /فروش\s*(خالص|صادرات|داخلي|سهام)/i, metric: METRICS.revenues, money: true, exclude: /تمام|دريافت|پرداخت|حاصل/ },
  { re: /مبلغ\s*فروش/i, metric: METRICS.revenues, money: true },
  { re: /سود\s*\(\s*زيان\s*\)\s*عمليات/i, metric: METRICS.ebit, money: true },
  { re: /سود\s*عمليات/i, metric: METRICS.ebit, money: true },
  { re: /سود\s*\(\s*زيان\s*\)\s*قبل\s*از/i, metric: METRICS.preTaxIncome, money: true },
  { re: /سود\s*قبل\s*از/i, metric: METRICS.preTaxIncome, money: true },
  { re: /هزينه\s*هاي?\s*مال/i, metric: METRICS.interestExpense, money: true },
  { re: /مالیات\s*بر\s*درآمد/i, metric: METRICS.taxExpense, money: true, exclude: /قبل|پرداختني|اول|اقلام/ },
  { re: /سود\s*\(\s*زيان\s*\)\s*خالص\s*هر\s*سهم/i, metric: METRICS.eps, money: false },
  { re: /سود\s*پايه\s*هر\s*سهم/i, metric: METRICS.eps, money: false },
  { re: /سود\s*\(\s*زيان\s*\)\s*خالص/i, metric: METRICS.netIncome, money: true },
  { re: /سود\s*خالص/i, metric: METRICS.netIncome, money: true },
  // ── Cash flow ──
  { re: /جريان\s*خالص.*نقد.*فعاليت.*عمليات/i, metric: METRICS.operatingCashFlow, money: true },
  { re: /خالص\s*جريان\s*وجوه\s*نقد.*فعاليت/i, metric: METRICS.operatingCashFlow, money: true },
  { re: /پرداخت.*نقد.*خريد\s*دارايي.*ثابت\s*مشه/i, metric: METRICS.capex, money: true },
  // ── Balance sheet (specific before totals so "داراييهاي جاري" doesn't match "داراييها") ──
  { re: /جمع\s*دارايي\s*هاي\s*جاري/i, metric: METRICS.currentAssets, money: true },
  { re: /جمع\s*بدهي\s*هاي\s*جاري/i, metric: METRICS.currentLiabilities, money: true },
  { re: /جمع\s*دارايي\s*ها(?!ي)/i, metric: METRICS.totalAssets, money: true },
  { re: /جمع\s*بدهي\s*ها(?!ي)/i, metric: METRICS.totalLiabilities, money: true, exclude: /حقوق|مرتبط/ },
  { re: /جمع\s*حقوق\s*(صاحبا|مالکان)/i, metric: METRICS.shareholdersEquity, money: true },
  { re: /حقوق\s*(صاحبا|مالکان)/i, metric: METRICS.shareholdersEquity, money: true, exclude: /جمع\s*بدهي|بدهي\s*مرتبط|قابل\s*انتساب/ },
  { re: /پرداختني\s*هاي\s*بلندمدت/i, metric: METRICS.totalDebt, money: true },
  { re: /سود\s*انباشته/i, metric: METRICS.retainedEarnings, money: true },
  { re: /تسهيلات\s*مالي\s*بلندمدت/i, metric: METRICS.totalDebt, money: true },
  { re: /تسهيلات\s*مالي\b/i, metric: METRICS.totalDebt, money: true },
];

/**
 * Normalize a Persian/Arabic label for regex matching.
 * Strips zero-width non-joiners and maps all ي/ی/ى variants to ي (Arabic Yeh).
 */
function normLabel(s: string): string {
  return s
    .replace(/‌/g, "")        // strip zero-width non-joiner
    .replace(/ی/g, "ي")  // ی → ي (Persian Yeh → Arabic Yeh)
    .replace(/ى/g, "ي"); // ى → ي (Alef Maqsura → Arabic Yeh)
}

/**
 * For a statement's period header row (e.g. "شرح | دوره منتهی به … | تجدید
 * ارائه شده | درصد تغییر"), return the column index holding the CURRENT period.
 * Standard 4/5-col statements put current first (index 1); the insurer's 7-col
 * trend table puts the current 12-month period at the SECOND-TO-LAST index,
 * followed by a "برآورد" (forecast) column. We detect it from the header's own
 * cell text.
 */
function findCurrentPeriodColumn(header: string[]): number {
  let current = 1;
  for (let i = 1; i < header.length; i++) {
    const h = normLabel(header[i]);
    const isPeriod = /منتهي|به\s*تاريخ|^\d{4}\/|دوره/.test(h);
    const isRestated = /تجديد|برآورد|درصد\s*تغيير|سال\s*قبل|سال\s*گذشته/.test(h);
    if (isPeriod && !isRestated) current = i;
  }
  return current;
}

/**
 * Parse Codal mso-HTML "Excel" attachment and extract fundamentals.
 * Numbers in the HTML are clean (no scrambling). The unit is detected from the
 * full document — modern Codal statements (FY1400+) are all میلیون ریال.
 *
 * Current-period column: derived from the nearest period header row ("شرح")
 * wherever one exists. Standard statements put the current period first; the
 * insurer trend table (7 cols) puts it second-to-last before a forecast column.
 */
export function parseHtml(html: string): { metric: MetricKey; value: number }[] {
  const rows = parseHtmlTable(html);
  const stripped = html.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&#?\w+;/g, " ");
  const unit = detectUnit(stripped);

  const found = new Map<MetricKey, number>();
  // Insurers in interpretive mode (گزارش تفسیری, e.g. بیمه ملت) lack an earned
  // "درآمدهای بیمه ای" line — gross premium written is then the best revenue
  // proxy. When a real earned row exists (standard insurers like بیمه دانا),
  // drop the gross-premium-only fallback so revenue stays the earned top-line.
  const EARNED_INS = /درآمد[هاي]*\s*بيمه\s*اي/i;
  const hasEarnedInsRow = rows.some((row) => {
    const halves: string[][] = row.length >= 8 ? [row.slice(0, 4), row.slice(4)] : [row];
    return halves.some((half) => {
      const label = normLabel(half[0] ?? "");
      return EARNED_INS.test(label) && !/ساير|حق\s*بيمه|سرمایه/.test(label);
    });
  });
  const rules = hasEarnedInsRow ? HTML_RULES.filter((r) => !r.grossPremiumOnly) : HTML_RULES;

  // Width of the most recent period header row → which column is the current period.
  const currentColByWidth = new Map<number, number>();
  for (const row of rows) {
    // Remember current-period column for this row width from a "شرح" header.
    // Header rows are 3+ cols wide and have "شرح" in the first cell.
    const label0 = normLabel(row[0] ?? "");
    if (label0 === "شرح" && row.length >= 3) {
      currentColByWidth.set(row.length, findCurrentPeriodColumn(row));
    }

    // Skip 10+ col rows: 13-col equity-movement pivots and 15+ col monthly
    // tables, whose cells aren't the current/prior statement layout. Allow up
    // to 9 — standard annuals with current/prior/%chg columns are 8 wide.
    if (row.length < 2 || row.length > 9) continue;

    // Balancesheets may split two labelled halves side by side (insurers):
    // [label_A, cur_A, prior_A, %A, label_B, cur_B, prior_B, %B].
    // Split both halves as if separate rows; each has label + values.
    const halves: string[][] = row.length >= 8 ? [row.slice(0, 4), row.slice(4)] : [row];
    for (const half of halves) {
      const rawLabel = half[0];
      if (!rawLabel) continue;
      const label = normLabel(rawLabel);

      // Current-period column: header-derived when available (handles the
      // insurer 7-col trend table), else first numeric after the label.
      let currentVal: number | null = null;
      const currentCol = currentColByWidth.get(row.length);
      if (currentCol != null && currentCol < half.length) {
        currentVal = parseAmount(half[currentCol]);
      }
      if (currentVal == null) {
        for (let i = 1; i < half.length; i++) {
          const v = parseAmount(half[i]);
          if (v != null) { currentVal = v; break; }
        }
      }
      if (currentVal == null) continue;

      for (const rule of rules) {
        if (!rule.re.test(label)) continue;
        if (rule.exclude && rule.exclude.test(label)) continue;
        if (found.has(rule.metric)) break; // first match wins (consolidated before individual)
        const value = rule.money ? currentVal * unit : currentVal;
        found.set(rule.metric, value);
        break;
      }
    }
  }
  return [...found.entries()].map(([metric, value]) => ({ metric, value }));
}

/**
 * Extract [metric, value] from a statement PDF buffer using positional layout.
 * `value` is scaled to Rial (per_share metrics stay as-is).
 * NOTE: PDF text extraction scrambles digit sequences in Codal statements.
 * This is kept as a fallback; parseHtml() is preferred.
 */
export async function parsePdf(buf: Buffer): Promise<{ metric: MetricKey; value: number }[]> {
  let pdfjs: Pdfjs;
  try {
    const mod = (await import("pdfjs-dist/legacy/build/pdf.js")) as any;
    pdfjs = mod.getDocument ? (mod as Pdfjs) : (mod.default as Pdfjs);
  } catch (e) {
    throw new Error(`pdfjs-dist unavailable: ${(e as Error).message}`);
  }
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;

  const rows: Row[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const byY = new Map<number, Cell[]>();
    for (const it of tc.items) {
      const str = (it.str ?? "").trim();
      if (!str) continue;
      const x = it.transform?.[4] ?? 0;
      const y = it.transform?.[5] ?? 0;
      const key = Math.round(y * 2) / 2;
      if (!byY.has(key)) byY.set(key, []);
      byY.get(key)!.push({ str, x });
    }
    for (const [y, cells] of byY) rows.push({ y, cells });
  }
  rows.sort((a, b) => (b.y - a.y) || (a.cells[0].x - b.cells[0].x));

  const text = rows.map((r) => r.cells.map((c) => c.str).join(" ")).join("\n");
  const realUnit = detectUnit(text);

  const found = new Map<MetricKey, number>();
  for (const row of rows) {
    // Split row into label cells (no digits) and amount cells (contain digits).
    const labelCells = row.cells.filter((c) => !/\d/.test(faDigits(c.str)));
    const amtCells = row.cells
      .filter((c) => /\d/.test(faDigits(c.str)))
      .sort((a, b) => a.x - b.x);
    if (!amtCells.length) continue;
    const label = labelCells
      .sort((a, b) => a.x - b.x)
      .map((c) => c.str.normalize("NFKC"))
      .join(" ");
    // Current period = rightmost numeric cell (RTL: first data column after شرح).
    const current = parseAmount(amtCells[amtCells.length - 1].str);
    if (current == null) continue;
    for (const pat of PATTERNS) {
      if (pat.exclude && label.includes(pat.exclude)) continue;
      if (!label.includes(pat.pattern)) continue;
      const value = pat.scale === "money" ? current * realUnit : current;
      found.set(pat.metric, value); // later rows win (totals appear after sub-rows)
      break;
    }
  }
  return [...found.entries()].map(([metric, value]) => ({ metric, value }));
}

/** Persist extracted line items into `fundamentals` for a fiscal year. */
function upsertRows(insCode: string, fy: number, rows: { metric: MetricKey; value: number }[]) {
  const stmt = db.prepare(
    `INSERT INTO fundamentals (ins_code, fy, metric, value, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(ins_code, fy, metric) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
  );
  for (const r of rows) stmt.run(insCode, fy, r.metric, r.value, Date.now());
}

/**
 * Parse the recorded statements for an instrument and load extracted line
 * items into `fundamentals` under the fiscal year each doc belongs to.
 * Prefers Excel HTML (clean numbers); falls back to PDF (scrambled digits).
 * Returns `{ items, docs }` — line items written and docs successfully parsed.
 */
export async function parseAndLoadStatements(insCode: string): Promise<{ items: number; docs: number }> {
  const docs = (
    db.prepare(
      "SELECT tracing_no, pdf_path, excel_url, fy FROM statement_docs WHERE ins_code = ? AND (pdf_path IS NOT NULL OR excel_url IS NOT NULL) ORDER BY fy DESC",
    ).all(insCode) as { tracing_no: number; pdf_path: string | null; excel_url: string | null; fy: number | null }[]
  ).filter((d) => d.fy);
  if (!docs.length) return { items: 0, docs: 0 };

  // Lazy-import Codal download helpers (avoid circular deps at top level)
  const { excelUrl, downloadExcel, downloadPdf } = await import("./codal");

  let items = 0;
  let parsed = 0;
  for (const d of docs) {
    try {
      let rows: { metric: MetricKey; value: number }[] = [];

      // Prefer Excel HTML (clean numbers)
      if (d.excel_url) {
        try {
          const url = d.excel_url.startsWith("http") ? d.excel_url : `https://www.codal.ir/${d.excel_url}`;
          const html = await downloadExcel(url);
          rows = parseHtml(html);
        } catch (e) {
          console.warn("excel download/parse failed for", d.tracing_no, (e as Error).message);
        }
      }

      // Fallback to PDF (digits may be scrambled)
      if (!rows.length && d.pdf_path) {
        const abs = path.isAbsolute(d.pdf_path) ? d.pdf_path : path.join(process.cwd(), d.pdf_path);
        if (fs.existsSync(abs)) {
          rows = await parsePdf(fs.readFileSync(abs));
        }
      }

      if (rows.length) {
        upsertRows(insCode, d.fy as number, rows);
        db.prepare("UPDATE statement_docs SET parsed_at = ? WHERE tracing_no = ?").run(Date.now(), d.tracing_no);
        items += rows.length;
        parsed++;
      }
    } catch (e) {
      console.error("parse failed for doc", d.tracing_no, (e as Error).message);
    }
  }
  return { items, docs: parsed };
}
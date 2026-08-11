// Codal (codal.ir) client — the official securities announcement network.
// The search API returns letter METADATA only (no numeric line items); the
// numbers live in PDF/Excel attachments. `downloadPdf` fetches attachments
// anonymously via the PdfUrl the search response already carries.

const SEARCH_BASE = "https://search.codal.ir";
const WWW = "https://www.codal.ir";
const UA = "rvos-market-bot/0.1 (+research)";

// ---------------------------------------------------------------------------
// Rate limiting / backoff — Codal throttles bursty search traffic with HTTP 429
// (verified from the sandbox: ~250 rapid page requests → multi-minute block).
// The sync jobs page aggressively across many letters, so throttle here once.
// ---------------------------------------------------------------------------
const MIN_REQUEST_GAP_MS = 1100; // ≥1 request/sec keeps us under the radar
let lastSearchAt = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Space out search requests: at least MIN_REQUEST_GAP_MS between them. */
async function throttleSearch() {
  const wait = MIN_REQUEST_GAP_MS - (Date.now() - lastSearchAt);
  if (wait > 0) await sleep(wait);
  lastSearchAt = Date.now();
}

export type CodalLetter = {
  TracingNo?: number;
  Symbol?: string;
  CompanyName?: string;
  Title?: string;
  LetterCode?: string; // standard form, e.g. "ن-۱۰"
  SentDateTime?: string;
  PublishDateTime?: string;
  HasHtml?: boolean;
  HasExcel?: boolean;
  HasPdf?: boolean;
  HasXbrl?: boolean;
  HasAttachment?: boolean;
  Url?: string;
  AttachmentUrl?: string;
  PdfUrl?: string; // e.g. "DownloadFile.aspx?hs=...&ft=1005&let=6"
  ExcelUrl?: string;
};

// The search API's `Length` param is the reporting PERIOD in months (-1..12; -1 = any),
// NOT the page size. Page size is fixed at 20 (results.total / results.page).
export const CODAL_PAGE_SIZE = 20;

export type SearchResult = { total: number; page: number; letters: CodalLetter[] };

export async function searchLetters(params: {
  letterType?: number;
  fromDate?: string; // Jalali "1405/01/01"
  toDate?: string; // Jalali
  search?: string;
  period?: number; // reporting period in months: -1 (any) .. 12
  page?: number;
  /** Filter by the exact Persian symbol (e.g. "فولاد") — the Symbol= API param. */
  symbol?: string;
}): Promise<SearchResult> {
  const q = new URLSearchParams({
    auditorRef: "-1",
    Category: "-1",
    Childs: "true",
    CompanyState: "-1",
    CorporateIdentifier: "-1",
    Mains: "true",
    NotAuditedRef: "-1",
    Publisher: "false",
    TracingNo: "-1",
    LetterType: String(params.letterType ?? -1),
    FromDate: params.fromDate ?? "",
    ToDate: params.toDate ?? "",
    Length: String(params.period ?? -1),
    PageNumber: String(params.page ?? 1),
    search: params.search ? "true" : "false",
    searchText: params.search ?? "",
  });
  // Symbol-scoped query (verified live): Symbol=<persian symbol> narrows the
  // feed to one company, so a symbol's own letters are reachable in a few pages
  // instead of being buried in the global publish-date feed.
  if (params.symbol) q.set("Symbol", params.symbol);
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await throttleSearch();
      const res = await fetch(`${SEARCH_BASE}/api/search/v2/q?${q}`, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(25000),
      });
      if (res.status === 429) {
        // Codal throttled us. Back off hard and re-loop — respect Retry-After
        // if the gateway bothered to send one, otherwise grow 20/40/80s.
        const retryAfter = Number(res.headers.get("retry-after"));
        const waitMs = (Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : 20_000 * 2 ** attempt);
        console.warn(`[codal] HTTP 429 throttled — backing off ${Math.round(waitMs / 1000)}s`);
        await sleep(Math.min(waitMs, 160_000));
        continue;
      }
      if (!res.ok) throw new Error(`codal search HTTP ${res.status}`);
      const d = (await res.json()) as { Total?: number; Page?: number; Letters?: CodalLetter[] };
      return { total: d.Total ?? 0, page: d.Page ?? 1, letters: d.Letters ?? [] };
    } catch (e) {
      lastErr = e;
      if (attempt < 3) await sleep(500 * 2 ** attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Absolute PDF URL for a letter, if one exists. */
export function pdfUrl(l: CodalLetter): string | null {
  if (!l.PdfUrl) return null;
  return l.PdfUrl.startsWith("http") ? l.PdfUrl : `${WWW}/${l.PdfUrl}`;
}

export async function downloadPdf(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`pdf download HTTP ${res.status}`);
  return res.arrayBuffer();
}

/** Absolute Excel URL for a letter, if one exists. */
export function excelUrl(l: CodalLetter): string | null {
  if (!l.ExcelUrl) return null;
  return l.ExcelUrl.startsWith("http") ? l.ExcelUrl : `${WWW}/${l.ExcelUrl}`;
}

/** Download Excel attachment. Returns HTML text (Codal's "Excel" is mso-HTML). */
export async function downloadExcel(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`excel download HTTP ${res.status}`);
  return res.text();
}

/**
 * Fetch a letter's inline body — the Codal detail page (`Url`, e.g.
 * `/Reports/Decision.aspx?LetterSerial=...` or `/Reports/Attachment.aspx?...`).
 * Letters without a PDF/Excel attachment (e.g. board reports) render their
 * content here as HTML, so this recovers text that would otherwise be lost.
 */
export async function downloadLetterHtml(l: CodalLetter): Promise<string> {
  const url = l.Url ?? "";
  const abs = url.startsWith("http") ? url : `${WWW}/${url}`;
  const res = await fetch(abs, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`letter html download HTTP ${res.status}`);
  return res.text();
}

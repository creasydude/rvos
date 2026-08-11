// Fundamental context loader — deterministic, pure DB reads.
//
// Turns the stored statement line items + the extracted narrative text of the
// period's statement doc and important reports into a compact, token-capped
// "context" bundle handed to the LLM beside the brain's computed ratios. No LLM
// involvement: the brain does math, this file does data prep, and the synthesis
// model reasons over the numbers + the real statement text.
//
// Numbers here are raw stored values = Iranian rial (parsers apply the unit
// multiplier at ingest). `units: "rial"` tells the synthesis prompt how to talk
// about them.

import { db } from "@/lib/db";
import { ensureMarketSchema } from "./schema";
import { METRICS } from "./metrics";

ensureMarketSchema();

type Row = Record<string, unknown>;
// node:sqlite binds only these scalar JS values.
type SqlValue = string | number | bigint | null | Uint8Array;

function list(sql: string, ...params: SqlValue[]): Row[] {
  return db.prepare(sql).all(...params) as Row[];
}
function one(sql: string, ...params: SqlValue[]): Row | undefined {
  return db.prepare(sql).get(...params) as Row | undefined;
}

/** Persian labels for the fixed statement metric vocabulary (metrics.ts). */
const METRIC_LABELS: Record<string, string> = {
  [METRICS.netIncome]: "سود خالص",
  [METRICS.revenues]: "درآمد عملیاتی",
  [METRICS.cogs]: "بهای تمام شده",
  [METRICS.ebitda]: "EBITDA",
  [METRICS.ebit]: "سود عملیاتی",
  [METRICS.preTaxIncome]: "سود قبل از کسر مالیات",
  [METRICS.taxExpense]: "هزینه مالیات",
  [METRICS.interestExpense]: "هزینه‌های مالی",
  [METRICS.totalAssets]: "جمع دارایی‌ها",
  [METRICS.totalLiabilities]: "جمع بدهی‌ها",
  [METRICS.shareholdersEquity]: "حقوق صاحبان سهام",
  [METRICS.totalDebt]: "کل بدهی (اجاره + تسهیلات)",
  [METRICS.currentAssets]: "دارایی‌های جاری",
  [METRICS.currentLiabilities]: "بدهی‌های جاری",
  [METRICS.fcf]: "جریان نقد آزاد",
  [METRICS.capex]: "سرمایه‌گذاری (CAPEX)",
  [METRICS.operatingCashFlow]: "جریان نقد عملیاتی",
  [METRICS.retainedEarnings]: "سود انباشته",
  [METRICS.dividendsPerShare]: "سود نقدی هر سهم",
  [METRICS.eps]: "سود هر سهم",
};

export type FundamentalLineItem = { metric: string; label: string; value: number; fy: number };

export type FundamentalReportContext = {
  kind: string;
  title: string;
  published: string | null;
  excerpt: string;
};

export type FundamentalContext = {
  symbol: string | null;
  name: string | null;
  fy: number | null;
  periodEnd: string | null;
  /** Current fiscal year first, then prior — raw values in Iranian rial. */
  lineItems: FundamentalLineItem[];
  /** Latest periodic financial statement + its narrative excerpt. */
  statement: { title: string; periodEnd: string | null; excerpt: string } | null;
  /** Up to 4 important reports, interpretive first. */
  reports: FundamentalReportContext[];
  units: "rial";
};

/** Collapse whitespace and clip a long text to head + tail (token-safe). */
export function clipExcerpt(text: string | null | undefined, head = 2000, tail = 1200): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= head + tail + 200) return t;
  return `${t.slice(0, head)}\n… [truncated] …\n${t.slice(-tail)}`;
}

function epochDate(ms: unknown): string | null {
  const n = typeof ms === "number" && isFinite(ms) && ms > 0 ? ms : null;
  return n ? new Date(n).toISOString().slice(0, 10) : null;
}

/**
 * Load the fundamental context bundle for a synced symbol.
 * Pure DB reads; never throws. Callers (write-ups, market analyze) embed the
 * result in the fundamental JSON handed to the synthesis LLM.
 */
export async function loadFundamentalContext(insCode: string): Promise<FundamentalContext> {
  const inst = one("SELECT symbol, name FROM instruments WHERE ins_code = ?", insCode);

  const lates = one(
    "SELECT fy FROM (SELECT fy, SUM(updated_at) AS u FROM fundamentals WHERE ins_code = ? GROUP BY fy) ORDER BY fy DESC LIMIT 1",
    insCode,
  );
  const fy = lates?.fy ? Number(lates.fy) : null;

  const periodEndRow = one(
    "SELECT period_end FROM statement_docs WHERE ins_code = ? AND period_end IS NOT NULL ORDER BY fy DESC, tracing_no DESC LIMIT 1",
    insCode,
  );

  const lineItems: FundamentalLineItem[] = [];
  if (fy != null) {
    const rows = list(
      "SELECT metric, value, fy FROM fundamentals WHERE ins_code = ? AND fy IN (?, ?) ORDER BY fy DESC, metric",
      insCode,
      fy,
      fy - 1,
    ) as { metric: string; value: number; fy: number }[];
    for (const r of rows) {
      const label = METRIC_LABELS[r.metric] ?? r.metric;
      if (typeof r.value === "number" && isFinite(r.value)) {
        lineItems.push({ metric: r.metric, label, value: r.value, fy: Number(r.fy) });
      }
    }
  }

  // Pick the "statement" the write-up should cite. statement_docs can hold
  // non-statement rows (e.g. an AGM summary that parses a period date out of its
  // title), so prefer a doc whose title looks like a real periodic statement,
  // then any doc that actually carries extracted narrative text, then the newest.
  const STMT_TITLE_RE = /صورت\s*های?\s*مالی|صورت\s*مالی|اطلاعات\s*و\s*صورت|گزارش\s*تفسیری/i;
  const STMT_NOISE_RE =
    /دعوت\s*به\s*مجمع|خلاصه\s*تصمیمات|تصمیمات\s*مجمع|افشای\s*اطلاعات|گزارش\s*هیئت\s*مدیر|آگهی|مزایده|پورتفوی|پیش\s*بینی|برآورد\s*سود/i;
  // Codal titles embed ZWNJ (U+200C, "صورت‌های مالی"); strip it so the patterns
  // match the same way sync.ts's classifier does.
  const normTitle = (s: string) => s.replace(/[‌‏]/g, "").replace(/\s+/g, " ").trim();
  const docRows = list(
    "SELECT title, period_end, raw_text FROM statement_docs WHERE ins_code = ? AND title IS NOT NULL ORDER BY fy DESC, tracing_no DESC",
    insCode,
  ) as { title: string; period_end: string | null; raw_text: string | null }[];
  const doc =
    docRows.find((d) => STMT_TITLE_RE.test(normTitle(d.title)) && !STMT_NOISE_RE.test(normTitle(d.title))) ??
    docRows.find((d) => d.raw_text != null && d.raw_text.length > 0) ??
    docRows[0];

  const reportRows = list(
    `SELECT kind, title, published_at, raw_text FROM codal_reports
      WHERE ins_code = ? AND raw_text IS NOT NULL AND length(raw_text) > 0
      ORDER BY CASE kind WHEN 'interpretive' THEN 0 ELSE 1 END, COALESCE(published_at, 0) DESC
      LIMIT 4`,
    insCode,
  ) as { kind: string; title: string; published_at: number; raw_text: string }[];

  return {
    symbol: typeof inst?.symbol === "string" ? inst.symbol : null,
    name: typeof inst?.name === "string" ? inst.name : null,
    fy,
    periodEnd: typeof periodEndRow?.period_end === "string" ? periodEndRow.period_end : null,
    lineItems,
    statement: doc
      ? {
          title: typeof doc.title === "string" ? doc.title : "",
          periodEnd: typeof doc.period_end === "string" ? doc.period_end : null,
          excerpt: clipExcerpt(typeof doc.raw_text === "string" ? doc.raw_text : "", 2000, 1200),
        }
      : null,
    reports: reportRows.map((r) => ({
      kind: r.kind,
      title: typeof r.title === "string" ? r.title : "",
      published: epochDate(r.published_at),
      excerpt: clipExcerpt(r.raw_text, 1500, 800),
    })),
    units: "rial",
  };
}
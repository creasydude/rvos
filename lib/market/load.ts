// Bridge from the market data store into the brain's input shapes.
// `loadTechnicalInputs(insCode)` reads daily_bars → TechnicalInputs, and
// `loadFundamentalInputs(insCode)` reconstructs FundamentalInputs +
// PriorFundamentalInputs from the `fundamentals` metric table, auto-filling
// peer ratios from the sector average per the Phase-4 Hybrid decision.

import { db } from "@/lib/db";
import { ensureMarketSchema } from "./schema";
import { METRICS } from "./metrics";
import { FundamentalInputs, PriorFundamentalInputs, TechnicalInputs } from "@/brain/types";

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

// ---- technical -------------------------------------------------------------

/**
 * Read the stored daily bars (ASC by trading day) into a TechnicalInputs.
 * `close` is the official closed price (pClosing); high/low/open come straight
 * from the bar; `volume` is the traded share count. Only arrays equal in length
 * to `close` are emitted so the brain's `?? close` fallbacks stay intact.
 */
export function loadTechnicalInputs(insCode: string): TechnicalInputs {
  const rows = list(
    "SELECT close, high, low, open, volume FROM daily_bars WHERE ins_code = ? ORDER BY d_even ASC",
    insCode,
  ) as { close: number | null; high: number | null; low: number | null; open: number | null; volume: number | null }[];
  const pick = (k: "close" | "high" | "low" | "open" | "volume") =>
    rows.map((r) => r[k]).filter((v): v is number => typeof v === "number" && isFinite(v));

  const close = pick("close");
  const out: TechnicalInputs = { close };
  // TSETMC's GetClosingPriceDailyList leaves high/low = 0 on many days. A zero
  // is *finite*, so it would be emitted here and poison ATR/ADX/Stochastic/BB
  // (e.g. ATR ≈ the close on a 0/0 bar). Drop non-positive values and only emit
  // these series when they actually cover the close span, so the brain's
  // `?? close` fallback keeps high/low sane (an absent high/low is by design).
  const pickPos = (k: "high" | "low" | "open" | "volume") =>
    rows.map((r) => r[k]).filter((v): v is number => typeof v === "number" && isFinite(v) && v > 0);
  const high = pickPos("high");
  const low = pickPos("low");
  const open = pickPos("open");
  const volume = pickPos("volume");
  // Only emit an OHLC field when it has a real (positive) value on *every* bar.
  if (high.length === close.length && high.length) out.high = high;
  if (low.length === close.length && low.length) out.low = low;
  if (open.length === close.length && open.length) out.open = open;
  if (volume.length === close.length && volume.length) out.volume = volume;
  return out;
}

/** Latest snapshot price for labelling (technical.lastPrice / lastPrice). */
export function latestClose(insCode: string): number | null {
  const r = one("SELECT close FROM daily_bars WHERE ins_code = ? ORDER BY d_even DESC LIMIT 1", insCode);
  const v = r?.close;
  return typeof v === "number" && isFinite(v) ? v : null;
}

// ---- fundamental ------------------------------------------------------------

/** Map a stored snake_case metric → brain FundamentalInputs key. */
const METRIC_TO_INPUT: Record<string, string> = {
  [METRICS.netIncome]: "netIncome",
  [METRICS.revenues]: "revenue",
  [METRICS.cogs]: "cogs",
  [METRICS.ebitda]: "ebitda",
  [METRICS.ebit]: "ebit",
  [METRICS.preTaxIncome]: "preTaxIncome",
  [METRICS.taxExpense]: "taxExpense",
  [METRICS.interestExpense]: "interestExpense",
  [METRICS.totalAssets]: "totalAssets",
  [METRICS.totalLiabilities]: "totalLiabilities",
  [METRICS.shareholdersEquity]: "shareholdersEquity",
  [METRICS.totalDebt]: "totalDebt",
  [METRICS.currentAssets]: "currentAssets",
  [METRICS.currentLiabilities]: "currentLiabilities",
  [METRICS.fcf]: "fcf",
  [METRICS.capex]: "capex",
  [METRICS.operatingCashFlow]: "operatingCashFlow",
  [METRICS.retainedEarnings]: "retainedEarnings",
  [METRICS.dividendsPerShare]: "dividendsPerShare",
  [METRICS.eps]: "eps",
};

/** All metric rows for one fiscal year as a plain map of inputKey → value. */
function metricMap(insCode: string, fy: number): Record<string, number> {
  const rows = list("SELECT metric, value FROM fundamentals WHERE ins_code = ? AND fy = ?", insCode, fy) as {
    metric: string;
    value: number;
  }[];
  const out: Record<string, number> = {};
  for (const r of rows) {
    const key = METRIC_TO_INPUT[r.metric];
    if (key && typeof r.value === "number" && isFinite(r.value)) out[key] = r.value;
  }
  return out;
}

export type LoadedFundamental = {
  inputs: FundamentalInputs;
  prior?: PriorFundamentalInputs;
  fy: number | null;
};

/**
 * Build FundamentalInputs (+ PriorFundamentalInputs) for the most recent
 * complete fiscal year on file. Price/shares come from `instruments`; peers
 * auto-fill from the instrument's sector P/E (Phase-4 Hybrid).
 */
export function loadFundamentalInputs(insCode: string): LoadedFundamental {
  const inst = one(
    "SELECT symbol, name, last_price, open, shares_outstanding, est_eps, sector_pe, sector FROM instruments WHERE ins_code = ?",
    insCode,
  );

  const lates = one(
    "SELECT fy FROM (SELECT fy, SUM(updated_at) AS u FROM fundamentals WHERE ins_code = ? GROUP BY fy) ORDER BY fy DESC LIMIT 1",
    insCode,
  );
  const fy = lates?.fy ? Number(lates.fy) : null;

  const cur = fy != null ? metricMap(insCode, fy) : {};
  const prior = fy != null ? metricMap(insCode, fy - 1) : {};

  // price always resolves to a real number for the brain: instruments.last_price,
  // else the most recent stored bar close. (`price` is required on FundamentalInputs.)
  const lastPriceStored =
    typeof inst?.last_price === "number" && isFinite(inst.last_price) ? (inst.last_price as number) : null;
  const price = lastPriceStored ?? latestClose(insCode) ?? 0;
  const shares = typeof inst?.shares_outstanding === "number" && isFinite(inst.shares_outstanding) ? inst.shares_outstanding : null;
  const marketCap = shares != null ? price * shares : undefined;

  const eps = cur.eps ?? (typeof inst?.est_eps === "number" ? inst.est_eps : undefined);
  const bookValuePerShare = cur.shareholdersEquity != null && shares != null ? cur.shareholdersEquity / shares : undefined;
  const salesPerShare = cur.revenue != null && shares != null ? cur.revenue / shares : undefined;

  const inputs: FundamentalInputs = {
    price,
    ...(shares != null ? { sharesOutstanding: shares } : {}),
    ...(marketCap != null ? { marketCap } : {}),
    ...cur,
    ...(eps != null ? { eps } : {}),
    ...(bookValuePerShare != null ? { bookValuePerShare } : {}),
    ...(salesPerShare != null ? { salesPerShare } : {}),
    // Sector P/E is only a valid peer benchmark when positive. A negative
    // sector average (the sector is net loss-making, e.g. Iran Khodro's auto
    // sector) would invert the sign of the "vs peer premium" calc, so it's
    // dropped rather than forwarded as a peer.
    ...(typeof inst?.sector_pe === "number" && isFinite(inst.sector_pe) && inst.sector_pe > 0 ? { pePeer: inst.sector_pe } : {}),
  };

  // Prior year → only fields the F-Score inspects.
  const priorInputs: PriorFundamentalInputs | undefined = (() => {
    const keys: (keyof PriorFundamentalInputs)[] = [
      "netIncome", "operatingCashFlow", "totalAssets", "totalLiabilities", "currentAssets",
      "currentLiabilities", "revenue", "cogs", "sharesOutstanding",
    ];
    const o: Partial<PriorFundamentalInputs> = {};
    for (const k of keys) if (prior[k] != null) o[k] = prior[k];
    if (Object.keys(o).length && prior.sharesOutstanding == null && shares != null) o.sharesOutstanding = shares;
    return Object.keys(o).length ? (o as PriorFundamentalInputs) : undefined;
  })();

  return { inputs, prior: priorInputs, fy };
}
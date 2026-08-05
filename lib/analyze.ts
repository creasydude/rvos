// Orchestrates the synthesis step: parse structured notes → run brain →
// call synthesis endpoint with computed numbers → stream back. All math
// happens in the brain; the LLM only reasons over precomputed numbers.

import { analyzeFundamental } from "@/brain/fundamental";
import { analyzeTechnical } from "@/brain/technical";
import { Calc, FundamentalInputs, PriorFundamentalInputs, TechnicalInputs, num } from "@/brain/types";
import { getRoleAssignments } from "./db";
import { streamComplete } from "./llm";
import { buildSynthesisPrompt } from "./prompts";

const NUMERIC_FUNDAMENTAL_FIELDS = [
  "price", "sharesOutstanding", "marketCap", "netIncome", "revenue", "ebitda", "ebit",
  "preTaxIncome", "taxExpense", "interestExpense", "totalAssets", "totalLiabilities",
  "shareholdersEquity", "totalDebt", "currentAssets", "currentLiabilities", "fcf", "capex",
  "operatingCashFlow", "dividendsPerShare", "dividendPayoutRatio", "dividendGrowthRate",
  "retainedEarnings", "cogs", "eps", "bookValuePerShare", "salesPerShare", "pePeer",
  "evEbitdaPeer", "pbPeer", "psPeer", "ev", "beta", "sharesIssued", "buybacks",
  "fcfGrowthRate", "discountRate", "terminalGrowthRate", "netDebt",
] as const;

// Which fields are money magnitudes (B/M/T multipliers apply), which are rates
// (percent → /100), and which are plain numbers with no transformation.
const MONEY_FIELDS = new Set([
  "marketCap", "netIncome", "revenue", "ebitda", "ebit", "preTaxIncome", "taxExpense",
  "interestExpense", "totalAssets", "totalLiabilities", "shareholdersEquity", "totalDebt",
  "currentAssets", "currentLiabilities", "fcf", "capex", "operatingCashFlow",
  "retainedEarnings", "cogs", "ev", "netDebt", "buybacks",
] as const);
const RATE_FIELDS = new Set([
  "dividendPayoutRatio", "dividendGrowthRate", "fcfGrowthRate", "discountRate", "terminalGrowthRate",
] as const);
const SHARE_FIELDS = new Set([ // per-share / price / counts: no B/M multiplier, keep as-is
  "price", "sharesOutstanding", "sharesIssued", "eps", "bookValuePerShare", "salesPerShare",
  "pePeer", "evEbitdaPeer", "pbPeer", "psPeer", "dividendsPerShare", "beta",
] as const);

/** Parse a numeric-or-string-with-unit value into a clean number. */
function parseNum(raw: unknown, kind: "money" | "rate" | "plain"): number | undefined {
  if (typeof raw === "number") return isFinite(raw) ? raw : undefined;
  if (typeof raw !== "string") return undefined;
  const cleaned = raw.trim().replace(/[,$\s]/g, "");
  // Strip trailing "x" (e.g. "28x", "~12x") for ratios.
  const xMatch = cleaned.match(/^([\d.]+)x?$/i);
  if (xMatch) {
    const n = Number(xMatch[1]);
    return isFinite(n) ? n : undefined;
  }
  if (cleaned === "") return undefined;
  const unitMatch = cleaned.match(/^(-?[\d.]+)([BMT%]?)$/i);
  if (!unitMatch) return undefined;
  let n = Number(unitMatch[1]);
  if (!isFinite(n)) return undefined;
  const unit = unitMatch[2].toUpperCase();
  if (kind === "money" && unit === "B") n *= 1e9;
  else if (kind === "money" && unit === "M") n *= 1e6;
  else if (kind === "money" && unit === "T") n *= 1e12;
  else if (kind === "rate" && unit === "%") n /= 100; // 9% → 0.09
  return n;
}

export async function streamAnalysis(input: {
  fundamental?: string;
  technical?: string;
}): Promise<ReadableStream<string>> {
  const fundamentalJson = input.fundamental?.trim() || null;
  const technicalJson = input.technical?.trim() || null;

  const missing: string[] = [];
  if (!fundamentalJson) missing.push("fundamental data");
  if (!technicalJson) missing.push("technical data");

  // Brain over whatever is present. Calcs carry an explicit `unit` so the
  // synthesis LLM never has to guess a number's meaning (a value could be
  // $329.45/share, not $329 billion — units keep it unambiguous).
  const brainLines: string[] = [];
  if (fundamentalJson) {
    const parsed = safeJson(fundamentalJson);
    const inputs = toFundamentalInputs(parsed);
    const prior = toPriorInputs(parsed?.priorYear);
    const res = analyzeFundamental(inputs, prior);
    brainLines.push(...formatCalcs("fundamental", res.calcs, res.warnings));
  }
  if (technicalJson) {
    const parsed = safeJson(technicalJson);
    const res = analyzeTechnical(toTechnicalInput(parsed));
    brainLines.push(...formatCalcs("technical", res.calcs, res.warnings));
    if (res.lastPrice != null) brainLines.push(`technical last close = ${res.lastPrice}`);
  }

  const roles = getRoleAssignments();
  if (!roles.synthesis) throw new Error("No synthesis endpoint assigned — configure in Settings");

  const { system, user } = buildSynthesisPrompt({
    fundamental: fundamentalJson ?? "",
    technical: technicalJson ?? "",
    brain: brainLines.join("\n"),
    missing,
  });

  return streamComplete({ system, user, endpointId: roles.synthesis });
}

function safeJson(s: string): Record<string, unknown> | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Pulls a numeric field out of the LLM's JSON, coercing strings/units. */
function numField(obj: Record<string, unknown> | null | undefined, key: string): number | undefined {
  const kind = MONEY_FIELDS.has(key as never) ? "money" : RATE_FIELDS.has(key as never) ? "rate" : "plain";
  // Nested peer object (e.g. { peer: { peRatio: "28x" } }) → also accept `peer_pe`.
  const direct = parseNum(obj?.[key], kind);
  if (direct !== undefined) return direct;
  if (key === "pePeer" && obj && typeof obj.peer === "object") {
    const p = obj.peer as Record<string, unknown>;
    const v = parseNum(p.peRatio ?? p.pe ?? p.peRatioX, "plain");
    if (v !== undefined) return v;
  }
  return undefined;
}

function toFundamentalInputs(parsed: Record<string, unknown> | null): FundamentalInputs {
  const out: Record<string, unknown> = {};
  for (const key of NUMERIC_FUNDAMENTAL_FIELDS) {
    const v = numField(parsed, key);
    if (v !== undefined) out[key] = v;
  }
  // Aliases the model may emit instead of canonical keys.
  if (out.price === undefined && parsed) {
    const price = parseNum(parsed.currentPrice ?? parsed.priceUsd, "plain");
    if (price !== undefined) out.price = price;
  }
  if (out.dividendsPerShare === undefined && parsed) {
    const d = parseNum(parsed.dividend, "plain");
    if (d !== undefined) out.dividendsPerShare = d;
  }
  if (out.ev === undefined && parsed) {
    const e = parseNum(parsed.enterpriseValue, "money");
    if (e !== undefined) out.ev = e;
  }
  const proj = Array.isArray(parsed?.fcfProjection)
    ? (parsed!.fcfProjection as unknown[]).map((x) => (typeof x === "number" ? x : parseNum(x as string, "money"))).filter((n): n is number => n !== undefined)
    : undefined;
  if (proj && proj.length) out.fcfProjection = proj;
  return out as FundamentalInputs;
}

function toPriorInputs(prior: unknown): PriorFundamentalInputs | undefined {
  if (!prior || typeof prior !== "object") return undefined;
  const p = prior as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of ["netIncome", "operatingCashFlow", "totalAssets", "totalLiabilities", "currentAssets", "currentLiabilities", "revenue", "cogs", "sharesOutstanding"]) {
    const kind = MONEY_FIELDS.has(key as never) ? "money" : "plain";
    const v = parseNum(p[key], kind);
    if (v !== undefined) out[key] = v;
  }
  return Object.keys(out).length ? (out as PriorFundamentalInputs) : undefined;
}

function toTechnicalInput(parsed: Record<string, unknown> | null) {
  const close = asNumbers(parsed?.close);
  const high = asNumbers(parsed?.high);
  const low = asNumbers(parsed?.low);
  const volume = asNumbers(parsed?.volume);
  const out: TechnicalInputs = { close };
  // Only pass high/low/volume when actually present and sized to close; an empty
  // array would defeat analyzeTechnical's `?? close` fallback and crash ADX/ATR.
  if (high.length === close.length && high.length) out.high = high;
  if (low.length === close.length && low.length) out.low = low;
  if (volume.length === close.length && volume.length) out.volume = volume;
  return out;
}

function asNumbers(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === "number" && isFinite(x));
}

/** Renders brain calcs as readable, unit-labeled lines for the synthesis LLM. */
function formatCalcs(kind: string, calcs: Calc[], warnings: string[]): string[] {
  const lines = [`${kind} calcs:`];
  for (const c of calcs) {
    const unit = c.unit ? ` (${c.unit})` : "";
    const inputs = c.inputs.length ? `  // inputs: ${c.inputs.map((i) => `${i.name}=${i.value}`).join(", ")}` : "";
    lines.push(`- ${c.name} = ${num(c.value, 4)}${unit}${inputs}`);
  }
  for (const w of warnings) lines.push(`- SKIPPED: ${w}`);
  return lines;
}

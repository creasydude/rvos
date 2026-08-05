// Shared types for the brain. Pure data — no LLM, no IO.

/** A single input fact used by a calculation, so the output is traceable. */
export type Input = {
  name: string;
  value: string; // human-readable, e.g. "12.3"
  source: "fundamental" | "technical" | "assumed";
};

/** One calculated result: the value, its inputs, and the formula used. */
export type Calc = {
  name: string;
  value: number;
  unit?: "x" | "%" | "usd" | "usd-per-share" | "score" | "z" | "num" | "ratio" | "boolean";
  formula: string;
  inputs: Input[];
};

export type FundamentalInputs = {
  price: number; // current share price (used across several models)
  sharesOutstanding?: number;
  marketCap?: number;
  // Income statement
  netIncome?: number;
  revenue?: number;
  ebitda?: number;
  ebit?: number;
  preTaxIncome?: number;
  taxExpense?: number;
  interestExpense?: number;
  // Balance sheet
  totalAssets?: number;
  totalLiabilities?: number;
  shareholdersEquity?: number;
  totalDebt?: number;
  currentAssets?: number;
  currentLiabilities?: number;
  // Cash flow
  fcf?: number;
  capex?: number;
  operatingCashFlow?: number;
  dividendsPerShare?: number;
  dividendPayoutRatio?: number; // 0..1
  dividendGrowthRate?: number; // 0..1
  retainedEarnings?: number;
  cogs?: number;
  // Valuation & peers
  eps?: number;
  bookValuePerShare?: number;
  salesPerShare?: number;
  pePeer?: number; // peer/sector average P/E
  evEbitdaPeer?: number;
  pbPeer?: number;
  psPeer?: number;
  ev?: number; // enterprise value, if provided
  beta?: number;
  sharesIssued?: number; // for F-Score
  buybacks?: number;
  // DCF
  fcfProjection?: number[]; // projected FCF per year
  fcfGrowthRate?: number; // 0..1, used if no projection array
  discountRate?: number; // 0..1
  terminalGrowthRate?: number; // 0..1
  netDebt?: number;
};

export type TechnicalInputs = {
  close: number[];
  high?: number[];
  low?: number[];
  open?: number[];
  volume?: number[];
};

/** Prior-year statement figures for the Piotroski F-Score. */
export type PriorFundamentalInputs = {
  netIncome?: number;
  operatingCashFlow?: number;
  totalAssets?: number;
  totalLiabilities?: number;
  currentAssets?: number;
  currentLiabilities?: number;
  revenue?: number;
  cogs?: number;
  sharesOutstanding?: number;
};

export type BrainResult = {
  fundamental?: FundamentalResult;
  technical?: TechnicalResult;
};

export type FundamentalResult = {
  calcs: Calc[];
  warnings: string[]; // e.g. "DCF skipped: no discount rate provided"
};

export type TechnicalResult = {
  calcs: Calc[];
  warnings: string[];
  lastPrice?: number;
};

export const num = (n: number, d = 2) => {
  if (!isFinite(n)) return null;
  return Math.round(n * 10 ** d) / 10 ** d;
};

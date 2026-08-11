// Fixed vocabulary for parsed statement line items stored in `fundamentals.metric`.
// Loaders map these back to brain input keys (see lib/market/load.ts).

export const METRICS = {
  netIncome: "net_income",
  revenues: "revenue",
  cogs: "cogs",
  ebitda: "ebitda",
  ebit: "ebit",
  preTaxIncome: "pre_tax_income",
  taxExpense: "tax_expense",
  interestExpense: "interest_expense",
  totalAssets: "total_assets",
  totalLiabilities: "total_liabilities",
  shareholdersEquity: "shareholders_equity",
  totalDebt: "total_debt",
  currentAssets: "current_assets",
  currentLiabilities: "current_liabilities",
  fcf: "fcf",
  capex: "capex",
  operatingCashFlow: "operating_cash_flow",
  retainedEarnings: "retained_earnings",
  dividendsPerShare: "dividends_per_share",
  eps: "eps",
} as const;

export type MetricKey = (typeof METRICS)[keyof typeof METRICS];
export const METRIC_VALUES: MetricKey[] = Object.values(METRICS);
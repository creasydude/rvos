// Types for Iran Macro Regime Scenario Analysis.
// Pure data — no LLM, no IO, no political judgments.
//
// The scenario engine models:  macro regime → explicit assumptions →
// company operating assumptions → projected financials → DCF / valuation.
// The LLM never performs scenario arithmetic.

// ---------------------------------------------------------------------------
// Scenario identity
// ---------------------------------------------------------------------------

export type MacroScenarioId =
  | "persistent-sanctions"
  | "partial-normalization"
  | "full-normalization"
  | "severe-deterioration";

// ---------------------------------------------------------------------------
// Data provenance — every assumption carries a source tag
// ---------------------------------------------------------------------------

export type AssumptionSource =
  | "observed"         // from the company's actual financial data
  | "user"             // supplied by the user
  | "scenario-preset"  // from a built-in scenario definition
  | "derived";         // computed deterministically from other assumptions

export type ScenarioAssumption = {
  key: string;
  value: number;
  unit: string;
  source: AssumptionSource;
  description?: string;
};

// ---------------------------------------------------------------------------
// Macro assumptions — the regime's economic environment
// ---------------------------------------------------------------------------

export type MacroAssumptions = {
  inflationPath?: number[];          // annual inflation rates, e.g. [0.40, 0.35, 0.30, 0.25, 0.20]
  fxPath?: number[];                 // annual IRR/USD rates, e.g. [580000, 610000, 590000, 570000, 560000]
  fxDepreciationRate?: number[];     // annual % change in FX, positive = depreciation
  discountRate?: number;             // required return / cost of equity for DCF
  terminalGrowthRate?: number;       // perpetuity growth rate
  countryRiskPremium?: number;       // additive country risk in discount rate
  exitMultiple?: number;             // EV/EBITDA exit multiple for alternate valuation
  exportAccessibility?: number;      // 0–1 scale: how accessible export channels are
  bankingAccessibility?: number;     // 0–1 scale: how accessible banking/payment channels are
  foreignFinancingAccessibility?: number; // 0–1 scale
  tradeAccessibility?: number;       // 0–1 scale
};

// ---------------------------------------------------------------------------
// Company operating assumptions — explicit adjustments to base-case financials
// ---------------------------------------------------------------------------

export type CompanyAssumptions = {
  revenueGrowthAdjustment?: number;   // additive delta to annual revenue growth (e.g. +0.05 = +5pp)
  exportVolumeAdjustment?: number;    // multiplicative factor on export revenue (1.0 = no change)
  domesticVolumeAdjustment?: number;  // multiplicative factor on domestic revenue
  realizationAdjustment?: number;     // multiplicative factor on selling price / realization
  ebitdaMarginAdjustment?: number;    // additive delta to EBITDA margin (e.g. +0.03 = +3pp)
  grossMarginAdjustment?: number;     // additive delta to gross margin
  capexAdjustment?: number;           // multiplicative factor on capex (1.0 = no change)
  workingCapitalDaysAdjustment?: number; // additive delta to working capital days
  taxRateAdjustment?: number;         // additive delta to effective tax rate
};

// ---------------------------------------------------------------------------
// Multi-year transition path — how assumptions evolve over the horizon
// ---------------------------------------------------------------------------

/** A year's worth of adjustments to the base case. Each field, when present,
 * replaces the scenario-level adjustment for that year. `null` = use the
 * scenario-level adjustment; missing = same. */
export type TransitionYear = {
  year: number; // 0 = current/base, 1..N = projection years
} & Partial<CompanyAssumptions>;

export type TransitionPath = {
  years: number; // horizon length (e.g. 5)
  annual: TransitionYear[];
};

// ---------------------------------------------------------------------------
// FX effects — explicit currency conversion
// ---------------------------------------------------------------------------

export type FxEffects = {
  /** Annual IRR/USD paths for the scenario (overrides macro.fxPath if present). */
  fxPath?: number[];
  /** Base-case IRR/USD (from observed data or user-supplied). */
  baseFxPath?: number[];
};

// ---------------------------------------------------------------------------
// Scenario configuration — the complete definition of one scenario
// ---------------------------------------------------------------------------

export type ScenarioConfig = {
  id: MacroScenarioId;
  name: string;
  description: string;
  macro: MacroAssumptions;
  company?: CompanyAssumptions;   // scenario-level adjustments (years interpolate toward these)
  transitionPath?: TransitionPath;
  probability?: number;           // 0..1, optional; only used when explicitly supplied
  fx?: FxEffects;
  metadata?: {
    source: AssumptionSource;
    note?: string; // e.g. "illustrative preset, not an empirical forecast"
  };
};

/** A preset with optional user overrides applied on top. */
export type ScenarioInput = {
  scenarioId: MacroScenarioId;
  /** User-supplied overrides to the preset assumptions. Applied on top. */
  overrides?: {
    macro?: Partial<MacroAssumptions>;
    company?: Partial<CompanyAssumptions>;
  };
  probability?: number;
};

// ---------------------------------------------------------------------------
// Base case — the company's current financial state
// ---------------------------------------------------------------------------

export type BaseCompanyData = {
  symbol?: string;
  name?: string;
  fy?: number | null;
  // Core financials (year 0)
  revenue: number;
  cogs?: number;
  ebitda?: number;
  ebit?: number;
  netIncome?: number;
  fcf?: number;
  capex?: number;
  operatingCashFlow?: number;
  // Margins (derived or provided)
  ebitdaMargin?: number; // ebitda / revenue
  grossMargin?: number;  // (revenue - cogs) / revenue
  taxRate?: number;      // taxExpense / preTaxIncome
  // Balance sheet
  totalAssets?: number;
  totalDebt?: number;
  netDebt?: number;
  currentAssets?: number;
  currentLiabilities?: number;
  workingCapital?: number; // currentAssets - currentLiabilities
  sharesOutstanding?: number;
  // DCF inputs
  discountRate?: number;
  terminalGrowthRate?: number;
  fcfGrowthRate?: number;
  fcfProjection?: number[];
  // Valuation
  price?: number;
  ev?: number;
  // FX
  fxRate?: number; // current IRR/USD
  // Peer multiples
  evEbitdaPeer?: number;
  pePeer?: number;
  // Metadata
  unitSystem?: "rial" | "usd";
  rawInputs?: Record<string, unknown>; // original FundamentalInputs for reference
};

// ---------------------------------------------------------------------------
// Year-by-year projected financials
// ---------------------------------------------------------------------------

export type ProjectedYear = {
  year: number;
  revenue: number;
  grossMargin?: number;
  ebitdaMargin?: number;
  ebitda?: number;
  ebit?: number;
  netIncome?: number;
  capex?: number;
  workingCapital?: number;
  workingCapitalDelta?: number;
  fcf?: number;
  fxRate?: number;
};

// ---------------------------------------------------------------------------
// DCF / valuation result
// ---------------------------------------------------------------------------

export type ScenarioDcfResult = {
  pvCashFlows: number;
  terminalValue?: number;
  pvTerminalValue?: number;
  enterpriseValue?: number;
  equityValue?: number;
  intrinsicValuePerShare?: number;
  marginOfSafety?: number; // (intrinsic / price - 1) * 100, when price available
  multipleValuation?: {
    exitMultiple?: number;
    terminalValue?: number;
    pvTerminalValue?: number;
    enterpriseValue?: number;
    equityValue?: number;
    intrinsicValuePerShare?: number;
  };
  warnings: string[];
};

// ---------------------------------------------------------------------------
// Operating bridge — transparent decomposition vs base case
// ---------------------------------------------------------------------------

export type BridgeComponent = {
  name: string;
  baseValue?: number;
  scenarioValue?: number;
  delta?: number;
  unit?: string;
  warning?: string;
};

export type ScenarioBridge = {
  revenue?: BridgeComponent[];
  ebitda?: BridgeComponent[];
  fcf?: BridgeComponent[];
  valuation?: BridgeComponent[];
};

// ---------------------------------------------------------------------------
// Sensitivity analysis — deterministic sensitivity tables
// ---------------------------------------------------------------------------

export type SensitivityPoint = {
  discountRate?: number;
  terminalGrowth?: number;
  exitMultiple?: number;
  intrinsicValuePerShare?: number;
  enterpriseValue?: number;
};

export type ScenarioSensitivity = {
  discountRate: SensitivityPoint[];
  terminalGrowth: SensitivityPoint[];
  exitMultiple: SensitivityPoint[];
};

// ---------------------------------------------------------------------------
// Scenario result — the complete output for one scenario
// ---------------------------------------------------------------------------

export type ScenarioResult = {
  scenarioId: MacroScenarioId;
  scenarioName: string;
  description: string;
  assumptions: {
    macro: ScenarioAssumption[];
    company: ScenarioAssumption[];
  };
  projectedFinancials: ProjectedYear[];
  dcf: ScenarioDcfResult;
  bridge: ScenarioBridge;
  sensitivity: ScenarioSensitivity;
  probability?: number;
  probabilityWeightedValue?: number;
  fx?: {
    path: number[];
    baseFxPath?: number[];
    usdIntrinsicValue?: number;
  };
  warnings: string[];
};

// ---------------------------------------------------------------------------
// Full scenario output — all scenarios for a symbol
// ---------------------------------------------------------------------------

export type ScenarioOutput = {
  symbol?: string;
  name?: string;
  baseCase: BaseCompanyData;
  baseValuation?: {
    dcfPerShare?: number;
    price?: number;
    marginOfSafety?: number;
  };
  results: ScenarioResult[];
  expectedValue?: number; // probability-weighted, only when probabilities supplied
  warnings: string[];
};

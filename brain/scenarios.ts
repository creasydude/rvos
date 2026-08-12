// Deterministic Iran Macro Regime Scenario Engine.
// Pure math — no LLM, no IO, no political judgments.
//
// The engine models: macro regime → explicit assumptions → company operating
// assumptions → projected financials → DCF / valuation → sensitivity.
// Every numerical output has a traceable input → assumption → calculation chain.

import { analyzeFundamental } from "./fundamental";
import { num } from "./types";
import {
  BaseCompanyData,
  BridgeComponent,
  MacroScenarioId,
  ProjectedYear,
  ScenarioAssumption,
  ScenarioBridge,
  ScenarioConfig,
  ScenarioDcfResult,
  ScenarioOutput,
  ScenarioResult,
  ScenarioSensitivity,
  SensitivityPoint,
  TransitionPath,
  TransitionYear,
} from "./scenario-types";

// Re-export types for external consumers
export type {
  BaseCompanyData,
  MacroScenarioId,
  ScenarioAssumption,
  ScenarioConfig,
  ScenarioInput,
  ScenarioOutput,
  ScenarioResult,
} from "./scenario-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Linearly interpolate between a and b at factor t ∈ [0, 1]. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

/** Clamp a number between min and max. */
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Build a transition path with `years` years of annual adjustments.
 *  Year 0 uses the base (no adjustment). Year N uses the scenario adjustment.
 *  Intermediate years interpolate linearly. */
function buildTransitionPath(
  company: Partial<import("./scenario-types").CompanyAssumptions> | undefined,
  transitionYears: number,
): TransitionYear[] {
  if (!company) {
    return Array.from({ length: transitionYears + 1 }, (_, i) => ({ year: i }));
  }
  const annual: TransitionYear[] = [];
  for (let y = 0; y <= transitionYears; y++) {
    const t = transitionYears === 0 ? 1 : y / transitionYears;
    const year: TransitionYear = { year: y };
    const keys: (keyof typeof company)[] = [
      "revenueGrowthAdjustment", "exportVolumeAdjustment", "domesticVolumeAdjustment",
      "realizationAdjustment", "ebitdaMarginAdjustment", "grossMarginAdjustment",
      "capexAdjustment", "workingCapitalDaysAdjustment", "taxRateAdjustment",
    ];
    for (const k of keys) {
      const target = company[k];
      if (target == null) continue;
      // Multiplicative factors: 1.0 is neutral; interpolate between 1.0 and target.
      // Additive deltas: 0.0 is neutral; interpolate between 0.0 and target.
      const isMultiplicative = k === "exportVolumeAdjustment" || k === "domesticVolumeAdjustment" ||
        k === "realizationAdjustment" || k === "capexAdjustment";
      const base = isMultiplicative ? 1.0 : 0.0;
      (year as Record<string, unknown>)[k] = lerp(base, target, t);
    }
    annual.push(year);
  }
  return annual;
}

/** Get the adjustment for a specific year and key.
 *  Year-specific override > scenario-level adjustment > neutral default. */
function getAdjustment(
  year: TransitionYear | undefined,
  key: keyof TransitionYear,
  scenarioDefault: number | undefined,
  isMultiplicative: boolean,
): number {
  const neutral = isMultiplicative ? 1.0 : 0.0;
  if (year && (year as Record<string, unknown>)[key] != null) {
    return (year as Record<string, unknown>)[key] as number;
  }
  return scenarioDefault ?? neutral;
}

// ---------------------------------------------------------------------------
// Scenario presets — illustrative economic regimes, not forecasts
// ---------------------------------------------------------------------------

const PRESETS: Record<MacroScenarioId, ScenarioConfig> = {
  "persistent-sanctions": {
    id: "persistent-sanctions",
    name: "Persistent Sanctions",
    description: "Sanctions remain broadly restrictive; banking/payment and export access constrained; elevated country risk.",
    macro: {
      inflationPath: [0.40, 0.38, 0.35, 0.32, 0.30],
      discountRate: 0.30,
      terminalGrowthRate: 0.05,
      countryRiskPremium: 0.10,
      exportAccessibility: 0.3,
      bankingAccessibility: 0.2,
      tradeAccessibility: 0.3,
      foreignFinancingAccessibility: 0.1,
    },
    company: {
      revenueGrowthAdjustment: -0.01,
      ebitdaMarginAdjustment: -0.01,
      capexAdjustment: 0.95,
    },
    transitionPath: { years: 5, annual: [] },
    metadata: { source: "scenario-preset", note: "Illustrative preset, not an empirical forecast." },
  },

  "partial-normalization": {
    id: "partial-normalization",
    name: "Partial Normalization",
    description: "Some external restrictions ease; trade/payment access improves gradually; country risk decreases moderately.",
    macro: {
      inflationPath: [0.35, 0.30, 0.25, 0.22, 0.20],
      discountRate: 0.25,
      terminalGrowthRate: 0.05,
      countryRiskPremium: 0.06,
      exportAccessibility: 0.6,
      bankingAccessibility: 0.5,
      tradeAccessibility: 0.6,
      foreignFinancingAccessibility: 0.4,
    },
    company: {
      revenueGrowthAdjustment: 0.02,
      exportVolumeAdjustment: 1.08,
      domesticVolumeAdjustment: 1.03,
      realizationAdjustment: 1.02,
      ebitdaMarginAdjustment: 0.01,
      capexAdjustment: 1.05,
    },
    transitionPath: { years: 5, annual: [] },
    metadata: { source: "scenario-preset", note: "Illustrative preset, not an empirical forecast." },
  },

  "full-normalization": {
    id: "full-normalization",
    name: "Full Normalization",
    description: "Substantial sanctions relief; materially improved trade, banking, and financing access; declining country risk.",
    macro: {
      inflationPath: [0.30, 0.25, 0.20, 0.15, 0.12],
      discountRate: 0.20,
      terminalGrowthRate: 0.04,
      countryRiskPremium: 0.03,
      exportAccessibility: 0.9,
      bankingAccessibility: 0.85,
      tradeAccessibility: 0.9,
      foreignFinancingAccessibility: 0.7,
      exitMultiple: 8,
    },
    company: {
      revenueGrowthAdjustment: 0.03,
      exportVolumeAdjustment: 1.15,
      domesticVolumeAdjustment: 1.05,
      realizationAdjustment: 1.03,
      ebitdaMarginAdjustment: 0.02,
      grossMarginAdjustment: 0.01,
      capexAdjustment: 1.10,
    },
    transitionPath: { years: 5, annual: [] },
    metadata: { source: "scenario-preset", note: "Illustrative preset, not an empirical forecast." },
  },

  "severe-deterioration": {
    id: "severe-deterioration",
    name: "Severe Deterioration",
    description: "Further trade restrictions; worse financing access; greater FX stress; weaker operating environment.",
    macro: {
      inflationPath: [0.50, 0.55, 0.50, 0.45, 0.40],
      discountRate: 0.35,
      terminalGrowthRate: 0.03,
      countryRiskPremium: 0.15,
      exportAccessibility: 0.15,
      bankingAccessibility: 0.10,
      tradeAccessibility: 0.15,
      foreignFinancingAccessibility: 0.05,
    },
    company: {
      revenueGrowthAdjustment: -0.03,
      exportVolumeAdjustment: 0.80,
      domesticVolumeAdjustment: 0.95,
      realizationAdjustment: 0.97,
      ebitdaMarginAdjustment: -0.02,
      grossMarginAdjustment: -0.01,
      capexAdjustment: 0.85,
    },
    transitionPath: { years: 5, annual: [] },
    metadata: { source: "scenario-preset", note: "Illustrative preset, not an empirical forecast." },
  },
};

/** Return the preset configuration for a scenario. */
export function getPreset(id: MacroScenarioId): ScenarioConfig {
  return { ...PRESETS[id] };
}

/** Return all four preset configurations. */
export function getAllPresets(): ScenarioConfig[] {
  return Object.values(PRESETS).map((p) => ({ ...p }));
}

// ---------------------------------------------------------------------------
// Build base company data from FundamentalInputs
// ---------------------------------------------------------------------------

/**
 * Convert FundamentalInputs (as loaded by lib/market/load.ts) into the
 * BaseCompanyData shape the scenario engine consumes. Derives margins and
 * working capital where the raw data allows it.
 */
export function buildBaseData(
  inputs: import("./types").FundamentalInputs,
  opts?: { symbol?: string; name?: string; fy?: number | null; fxRate?: number; unitSystem?: "rial" | "usd" },
): BaseCompanyData {
  const revenue = inputs.revenue ?? 0;
  const cogs = inputs.cogs;
  let ebitda = inputs.ebitda;
  const ebit = inputs.ebit;
  let fcf = inputs.fcf;
  const capex = inputs.capex;
  const operatingCashFlow = inputs.operatingCashFlow;
  const currentAssets = inputs.currentAssets;
  const currentLiabilities = inputs.currentLiabilities;
  const workingCapital = currentAssets != null && currentLiabilities != null
    ? currentAssets - currentLiabilities : undefined;

  // --- Estimate EBITDA when not directly available ---
  // The Codal parser extracts EBIT but often not EBITDA. Use a rough D&A
  // proxy (EBIT × 1.2 ≈ 20% add-back for depreciation & amortization).
  if (ebitda == null && ebit != null && ebit > 0) {
    ebitda = ebit * 1.2;
  }

  // --- Estimate FCF from available components ---
  // Primary: operatingCashFlow - capex (actual cash flow statement data).
  if (fcf == null && operatingCashFlow != null && capex != null) {
    fcf = operatingCashFlow - capex;
  }
  // Secondary: EBITDA-based proxy (EBITDA × (1 - taxRate) - capex).
  // Only when operatingCashFlow isn't available.
  if (fcf == null && ebitda != null && ebitda > 0 && capex != null && operatingCashFlow == null) {
    const tax = inputs.preTaxIncome != null && inputs.taxExpense != null && inputs.preTaxIncome > 0
      ? inputs.taxExpense / inputs.preTaxIncome : 0.25;
    fcf = ebitda * (1 - tax) - capex;
  }

  const ebitdaMargin = revenue > 0 && ebitda != null ? ebitda / revenue : undefined;
  const grossMargin = revenue > 0 && cogs != null ? (revenue - cogs) / revenue : undefined;
  const taxRate = inputs.preTaxIncome != null && inputs.taxExpense != null && inputs.preTaxIncome > 0
    ? inputs.taxExpense / inputs.preTaxIncome : undefined;
  const shares = inputs.sharesOutstanding;
  const price = inputs.price;
  const netDebt = inputs.netDebt ?? (inputs.totalDebt != null ? inputs.totalDebt : undefined);

  return {
    symbol: opts?.symbol,
    name: opts?.name,
    fy: opts?.fy,
    revenue,
    cogs,
    ebitda,
    ebit,
    netIncome: inputs.netIncome,
    fcf,
    capex,
    operatingCashFlow,
    ebitdaMargin,
    grossMargin,
    taxRate,
    totalAssets: inputs.totalAssets,
    totalDebt: inputs.totalDebt,
    netDebt,
    currentAssets,
    currentLiabilities,
    workingCapital,
    sharesOutstanding: shares,
    discountRate: inputs.discountRate,
    terminalGrowthRate: inputs.terminalGrowthRate,
    fcfGrowthRate: inputs.fcfGrowthRate,
    fcfProjection: inputs.fcfProjection,
    price,
    ev: inputs.ev,
    fxRate: opts?.fxRate,
    evEbitdaPeer: inputs.evEbitdaPeer,
    pePeer: inputs.pePeer,
    unitSystem: opts?.unitSystem,
    rawInputs: inputs,
  };
}

// ---------------------------------------------------------------------------
// Year-by-year projection engine
// ---------------------------------------------------------------------------

/**
 * Project year-by-year financials by applying scenario adjustments to the
 * base case. Each year's revenue grows from the prior year's level, adjusted
 * by the scenario's annual growth adjustment. Margins, capex, and working
 * capital are adjusted by the scenario's annual factors.
 *
 * This function never invents data. If a base value is missing, the
 * projection for that metric is skipped for that year.
 */
export function projectFinancials(
  base: BaseCompanyData,
  company: Partial<import("./scenario-types").CompanyAssumptions> | undefined,
  transition: TransitionPath | undefined,
): { years: ProjectedYear[]; warnings: string[] } {
  const warnings: string[] = [];
  const horizon = transition?.years ?? 5;
  const annual = (transition?.annual && transition.annual.length > 0)
    ? transition.annual
    : buildTransitionPath(company, horizon);

  if (base.revenue <= 0) {
    warnings.push("Base revenue is zero or negative — revenue projections will be flat.");
  }
  if (base.fcf == null && base.ebitda == null) {
    warnings.push("No FCF or EBITDA data available — cash flow projections skipped.");
  }

  const years: ProjectedYear[] = [];
  let prevRevenue = base.revenue;
  let prevWorkingCapital = base.workingCapital ?? 0;

  for (let y = 0; y <= horizon; y++) {
    // Year 0 is always the base case — no adjustments applied.
    const isBaseYear = y === 0;
    const yearDef = isBaseYear ? { year: 0 } : (annual.find((a) => a.year === y) ?? { year: y });

    // --- Revenue ---
    // Additive adjustments: 0 is neutral. Multiplicative: 1.0 is neutral.
    const growthAdj = isBaseYear ? 0 : getAdjustment(yearDef, "revenueGrowthAdjustment", company?.revenueGrowthAdjustment, false);
    const exportAdj = isBaseYear ? 1.0 : getAdjustment(yearDef, "exportVolumeAdjustment", company?.exportVolumeAdjustment, true);
    const domesticAdj = isBaseYear ? 1.0 : getAdjustment(yearDef, "domesticVolumeAdjustment", company?.domesticVolumeAdjustment, true);
    const realizationAdj = isBaseYear ? 1.0 : getAdjustment(yearDef, "realizationAdjustment", company?.realizationAdjustment, true);

    // Combine volume adjustments: average of export and domestic factors.
    // If only one is present, use it alone. If neither is present, factor = 1.0.
    const hasExport = exportAdj !== 1.0;
    const hasDomestic = domesticAdj !== 1.0;
    const volumeFactor = hasExport && hasDomestic
      ? (exportAdj + domesticAdj) / 2
      : hasExport ? exportAdj : hasDomestic ? domesticAdj : 1.0;

    // Revenue compounds on the PREVIOUS year's level, not the base.
    const yearRevenue = isBaseYear
      ? base.revenue
      : prevRevenue * (1 + growthAdj) * volumeFactor * realizationAdj;

    // --- Margins (additive deltas to base margins) ---
    const ebitdaMarginAdj = isBaseYear ? 0 : getAdjustment(yearDef, "ebitdaMarginAdjustment", company?.ebitdaMarginAdjustment, false);
    const grossMarginAdj = isBaseYear ? 0 : getAdjustment(yearDef, "grossMarginAdjustment", company?.grossMarginAdjustment, false);
    const yearEbitdaMargin = base.ebitdaMargin != null ? base.ebitdaMargin + ebitdaMarginAdj : undefined;
    const yearGrossMargin = base.grossMargin != null ? base.grossMargin + grossMarginAdj : undefined;

    const yearEbitda = yearEbitdaMargin != null ? yearRevenue * yearEbitdaMargin : undefined;
    const yearEbit = yearEbitda != null && base.ebit != null && base.ebitda != null && base.ebitda !== 0
      ? yearEbitda * (base.ebit / base.ebitda)
      : undefined;

    // --- Net income (approximate: EBITDA → EBIT → NI ratio) ---
    const yearNetIncome = yearEbit != null && base.ebit != null && base.ebit !== 0 && base.netIncome != null
      ? yearEbit * (base.netIncome / base.ebit)
      : undefined;

    // --- Capex ---
    const capexAdj = getAdjustment(yearDef, "capexAdjustment", company?.capexAdjustment, true);
    const yearCapex = base.capex != null ? base.capex * capexAdj : undefined;

    // --- Working capital ---
    const wcDaysAdj = getAdjustment(yearDef, "workingCapitalDaysAdjustment", company?.workingCapitalDaysAdjustment, false);
    const yearWorkingCapital = base.workingCapital != null
      ? base.workingCapital * (1 + wcDaysAdj) * (yearRevenue / (base.revenue || 1))
      : undefined;
    const yearWcDelta = yearWorkingCapital != null ? yearWorkingCapital - prevWorkingCapital : undefined;

    // --- FCF ---
    let yearFcf: number | undefined;
    const tax = base.taxRate ?? 0.25; // default 25% if unknown
    if (base.fcf != null && y === 0) {
      yearFcf = base.fcf;
    } else if (yearEbitda != null && yearCapex != null) {
      // FCF ≈ EBITDA × (1 - taxRate) - Capex - ΔWorkingCapital
      // ΔWC is optional — when missing, assume zero WC change.
      yearFcf = yearEbitda * (1 - tax) - yearCapex - (yearWcDelta ?? 0);
    } else if (base.fcf != null && yearRevenue > 0 && base.revenue > 0) {
      // Scale FCF proportionally with revenue as a fallback
      yearFcf = base.fcf * (yearRevenue / base.revenue);
    }

    // --- FX ---
    const yearFx = base.fxRate; // FX is applied at the valuation level, not here

    years.push({
      year: y,
      revenue: yearRevenue,
      grossMargin: yearGrossMargin,
      ebitdaMargin: yearEbitdaMargin,
      ebitda: yearEbitda,
      ebit: yearEbit,
      netIncome: yearNetIncome,
      capex: yearCapex,
      workingCapital: yearWorkingCapital,
      workingCapitalDelta: yearWcDelta,
      fcf: yearFcf,
      fxRate: yearFx,
    });

    prevRevenue = yearRevenue;
    if (yearWorkingCapital != null) prevWorkingCapital = yearWorkingCapital;
  }

  return { years, warnings };
}

// ---------------------------------------------------------------------------
// DCF valuation for a scenario's projected cash flows
// ---------------------------------------------------------------------------

/**
 * Compute DCF enterprise value from projected FCFs. Mirrors the DCF logic in
 * brain/fundamental.ts exactly, using the scenario's explicit discount rate,
 * terminal growth rate, and (optionally) exit multiple.
 *
 * Returns enterprise value, equity value, intrinsic value per share, and
 * separate multiple-based valuation when an exit multiple is provided.
 */
export function computeScenarioDcf(
  projected: ProjectedYear[],
  base: BaseCompanyData,
  macro: { discountRate?: number; terminalGrowthRate?: number; exitMultiple?: number },
): ScenarioDcfResult {
  const warnings: string[] = [];
  const r = macro.discountRate ?? base.discountRate;
  const g = macro.terminalGrowthRate ?? base.terminalGrowthRate;

  if (r == null) {
    warnings.push("DCF skipped: no discount rate available.");
    return { pvCashFlows: 0, warnings };
  }

  // FCF projection: skip year 0 (base), use years 1+
  const fcfYears = projected.filter((y) => y.year > 0 && y.fcf != null);
  if (fcfYears.length === 0) {
    warnings.push("DCF skipped: no projected FCF available.");
    return { pvCashFlows: 0, warnings };
  }

  const fcfs = fcfYears.map((y) => y.fcf!);

  // PV of projected cash flows (mirrors fundamental.ts exactly)
  const pvCashFlows = fcfs.reduce((sum, fcf, k) => sum + fcf / (1 + r) ** (k + 1), 0);

  let terminalValue: number | undefined;
  let pvTerminalValue: number | undefined;

  if (g != null && r > g) {
    // Gordon Growth terminal value
    terminalValue = fcfs[fcfs.length - 1] * (1 + g) / (r - g);
    pvTerminalValue = terminalValue / (1 + r) ** fcfs.length;
  } else if (g != null) {
    warnings.push("DCF terminal value skipped: terminal growth rate must be below discount rate.");
  }

  const enterpriseValue = pvCashFlows + (pvTerminalValue ?? 0);
  const netDebt = base.netDebt ?? 0;
  const equityValue = enterpriseValue - netDebt;
  const perShare = base.sharesOutstanding ? equityValue / base.sharesOutstanding : undefined;

  let marginOfSafety: number | undefined;
  if (perShare != null && base.price && base.price > 0) {
    marginOfSafety = (perShare / base.price - 1) * 100;
  }

  // --- Multiple-based valuation (separate from DCF) ---
  let multipleValuation: ScenarioDcfResult["multipleValuation"];
  const exitMultiple = macro.exitMultiple;
  if (exitMultiple != null) {
    const lastEbitda = fcfYears[fcfYears.length - 1]?.ebitda;
    if (lastEbitda != null && lastEbitda > 0) {
      const mvTerminalValue = lastEbitda * exitMultiple;
      const mvPvTerminal = mvTerminalValue / (1 + r) ** fcfs.length;
      const mvEv = pvCashFlows + mvPvTerminal;
      const mvEquity = mvEv - netDebt;
      const mvPerShare = base.sharesOutstanding ? mvEquity / base.sharesOutstanding : undefined;
      multipleValuation = {
        exitMultiple,
        terminalValue: mvTerminalValue,
        pvTerminalValue: mvPvTerminal,
        enterpriseValue: mvEv,
        equityValue: mvEquity,
        intrinsicValuePerShare: mvPerShare,
      };
    } else {
      warnings.push("Multiple valuation skipped: no positive projected EBITDA for exit multiple.");
    }
  }

  return {
    pvCashFlows,
    terminalValue,
    pvTerminalValue,
    enterpriseValue,
    equityValue,
    intrinsicValuePerShare: perShare,
    marginOfSafety,
    multipleValuation,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Operating bridge — how the scenario differs from base case
// ---------------------------------------------------------------------------

/**
 * Build a deterministic bridge showing the decomposition of scenario value
 * vs base case. Each component shows base value, scenario value, and delta.
 * Avoids double-counting by construction: each metric appears once.
 */
export function buildBridge(
  base: BaseCompanyData,
  projected: ProjectedYear[],
  dcf: ScenarioDcfResult,
): ScenarioBridge {
  const finalYear = projected[projected.length - 1];
  const firstProjected = projected.find((y) => y.year > 0);

  const revenue: BridgeComponent[] = [];
  if (base.revenue > 0 && firstProjected) {
    revenue.push({ name: "Base revenue", baseValue: base.revenue, unit: "rial" });
    revenue.push({ name: "Scenario revenue (Y5)", scenarioValue: finalYear?.revenue, unit: "rial" });
    if (finalYear) revenue.push({ name: "Revenue change", delta: finalYear.revenue - base.revenue, unit: "rial" });
  }

  const ebitda: BridgeComponent[] = [];
  if (base.ebitda != null && base.ebitda > 0) {
    ebitda.push({ name: "Base EBITDA margin", baseValue: base.ebitdaMargin != null ? base.ebitdaMargin * 100 : undefined, unit: "%" });
    ebitda.push({ name: "Scenario EBITDA margin (Y5)", scenarioValue: finalYear?.ebitdaMargin != null ? finalYear.ebitdaMargin * 100 : undefined, unit: "%" });
    if (base.ebitdaMargin != null && finalYear?.ebitdaMargin != null) {
      ebitda.push({ name: "Margin change", delta: (finalYear.ebitdaMargin - base.ebitdaMargin) * 100, unit: "pp" });
    }
    ebitda.push({ name: "Base EBITDA", baseValue: base.ebitda, unit: "rial" });
    ebitda.push({ name: "Scenario EBITDA (Y5)", scenarioValue: finalYear?.ebitda, unit: "rial" });
  }

  const fcf: BridgeComponent[] = [];
  if (base.fcf != null) {
    fcf.push({ name: "Base FCF", baseValue: base.fcf, unit: "rial" });
    fcf.push({ name: "Scenario FCF (Y5)", scenarioValue: finalYear?.fcf, unit: "rial" });
    if (finalYear?.fcf != null) fcf.push({ name: "FCF change", delta: finalYear.fcf - base.fcf, unit: "rial" });
  }

  const valuation: BridgeComponent[] = [];
  if (dcf.intrinsicValuePerShare != null) {
    valuation.push({ name: "DCF intrinsic value", scenarioValue: dcf.intrinsicValuePerShare, unit: base.unitSystem === "rial" ? "rial-per-share" : "usd-per-share" });
  }
  if (dcf.multipleValuation?.intrinsicValuePerShare != null) {
    valuation.push({ name: "Multiple-based value", scenarioValue: dcf.multipleValuation.intrinsicValuePerShare, unit: base.unitSystem === "rial" ? "rial-per-share" : "usd-per-share" });
  }

  return { revenue, ebitda, fcf, valuation };
}

// ---------------------------------------------------------------------------
// Sensitivity analysis — deterministic sensitivity tables
// ---------------------------------------------------------------------------

/**
 * Compute scenario sensitivity by varying one input at a time while holding
 * others constant. The LLM interprets the pre-computed table; it never
 * performs these calculations.
 */
export function computeSensitivity(
  projected: ProjectedYear[],
  base: BaseCompanyData,
  macro: { discountRate?: number; terminalGrowthRate?: number; exitMultiple?: number },
): ScenarioSensitivity {
  const baseR = macro.discountRate ?? 0.20;
  const baseG = macro.terminalGrowthRate ?? 0.04;

  const discountRatePoints: SensitivityPoint[] = [0.15, 0.18, 0.20, 0.22, 0.25, 0.28, 0.30, 0.35]
    .filter((r) => r > 0)
    .map((r) => {
      const dcf = computeScenarioDcf(projected, base, { ...macro, discountRate: r });
      return {
        discountRate: r,
        intrinsicValuePerShare: dcf.intrinsicValuePerShare,
        enterpriseValue: dcf.enterpriseValue,
      };
    });

  const terminalGrowthPoints: SensitivityPoint[] = [0.02, 0.03, 0.04, 0.05, 0.06, 0.08]
    .filter((g) => g < baseR)
    .map((g) => {
      const dcf = computeScenarioDcf(projected, base, { ...macro, terminalGrowthRate: g });
      return {
        terminalGrowth: g,
        intrinsicValuePerShare: dcf.intrinsicValuePerShare,
        enterpriseValue: dcf.enterpriseValue,
      };
    });

  const exitMultiplePoints: SensitivityPoint[] = [4, 5, 6, 7, 8, 10, 12]
    .map((m) => {
      const dcf = computeScenarioDcf(projected, base, { ...macro, exitMultiple: m });
      return {
        exitMultiple: m,
        intrinsicValuePerShare: dcf.multipleValuation?.intrinsicValuePerShare,
        enterpriseValue: dcf.multipleValuation?.enterpriseValue,
      };
    });

  return {
    discountRate: discountRatePoints,
    terminalGrowth: terminalGrowthPoints,
    exitMultiple: exitMultiplePoints,
  };
}

// ---------------------------------------------------------------------------
// Assumption packaging — collect explicit assumptions for output
// ---------------------------------------------------------------------------

function packageAssumptions(
  macro: import("./scenario-types").MacroAssumptions,
  company: Partial<import("./scenario-types").CompanyAssumptions> | undefined,
): { macro: ScenarioAssumption[]; company: ScenarioAssumption[] } {
  const macroAssumptions: ScenarioAssumption[] = [];
  const companyAssumptions: ScenarioAssumption[] = [];

  // Macro assumptions
  if (macro.discountRate != null) {
    macroAssumptions.push({ key: "discountRate", value: macro.discountRate, unit: "ratio", source: "scenario-preset", description: "Required return / cost of equity" });
  }
  if (macro.terminalGrowthRate != null) {
    macroAssumptions.push({ key: "terminalGrowthRate", value: macro.terminalGrowthRate, unit: "ratio", source: "scenario-preset", description: "Perpetuity growth rate for terminal value" });
  }
  if (macro.countryRiskPremium != null) {
    macroAssumptions.push({ key: "countryRiskPremium", value: macro.countryRiskPremium, unit: "ratio", source: "scenario-preset", description: "Additive country-risk premium in discount rate" });
  }
  if (macro.exitMultiple != null) {
    macroAssumptions.push({ key: "exitMultiple", value: macro.exitMultiple, unit: "x", source: "scenario-preset", description: "EV/EBITDA exit multiple for alternate valuation" });
  }
  if (macro.inflationPath) {
    macroAssumptions.push({ key: "inflationPath", value: macro.inflationPath[macro.inflationPath.length - 1], unit: "ratio", source: "scenario-preset", description: `Inflation path: ${macro.inflationPath.map((v) => `${(v * 100).toFixed(0)}%`).join(" → ")}` });
  }
  if (macro.fxPath) {
    macroAssumptions.push({ key: "fxPath", value: macro.fxPath[macro.fxPath.length - 1], unit: "IRR/USD", source: "scenario-preset", description: `FX path: ${macro.fxPath.map((v) => v.toLocaleString()).join(" → ")}` });
  }
  if (macro.exportAccessibility != null) {
    macroAssumptions.push({ key: "exportAccessibility", value: macro.exportAccessibility, unit: "0-1", source: "scenario-preset", description: "Export channel accessibility (0=none, 1=full)" });
  }
  if (macro.bankingAccessibility != null) {
    macroAssumptions.push({ key: "bankingAccessibility", value: macro.bankingAccessibility, unit: "0-1", source: "scenario-preset", description: "Banking/payment channel accessibility" });
  }
  if (macro.tradeAccessibility != null) {
    macroAssumptions.push({ key: "tradeAccessibility", value: macro.tradeAccessibility, unit: "0-1", source: "scenario-preset", description: "Trade channel accessibility" });
  }
  if (macro.foreignFinancingAccessibility != null) {
    macroAssumptions.push({ key: "foreignFinancingAccessibility", value: macro.foreignFinancingAccessibility, unit: "0-1", source: "scenario-preset", description: "Foreign financing accessibility" });
  }

  // Company assumptions
  if (company) {
    const entries: [keyof typeof company, string, string, string][] = [
      ["revenueGrowthAdjustment", "revenueGrowthAdjustment", "%-point", "Additive adjustment to annual revenue growth"],
      ["exportVolumeAdjustment", "exportVolumeAdjustment", "factor", "Multiplicative factor on export volume (1.0 = no change)"],
      ["domesticVolumeAdjustment", "domesticVolumeAdjustment", "factor", "Multiplicative factor on domestic volume"],
      ["realizationAdjustment", "realizationAdjustment", "factor", "Multiplicative factor on selling price / realization"],
      ["ebitdaMarginAdjustment", "ebitdaMarginAdjustment", "%-point", "Additive adjustment to EBITDA margin"],
      ["grossMarginAdjustment", "grossMarginAdjustment", "%-point", "Additive adjustment to gross margin"],
      ["capexAdjustment", "capexAdjustment", "factor", "Multiplicative factor on capex"],
      ["workingCapitalDaysAdjustment", "workingCapitalDaysAdjustment", "%-point", "Additive adjustment to working capital days"],
      ["taxRateAdjustment", "taxRateAdjustment", "%-point", "Additive adjustment to effective tax rate"],
    ];
    for (const [k, key, unit, desc] of entries) {
      const v = company[k];
      if (v != null) {
        companyAssumptions.push({ key, value: v, unit, source: "scenario-preset", description: desc });
      }
    }
  }

  return { macro: macroAssumptions, company: companyAssumptions };
}

// ---------------------------------------------------------------------------
// Main scenario analysis entry point
// ---------------------------------------------------------------------------

/**
 * Run the full scenario analysis for a set of scenarios.
 *
 * The function is pure and deterministic: given the same inputs, it always
 * produces the same outputs. No LLM calls, no network I/O.
 *
 * Each scenario result contains:
 * - Explicit assumptions (tagged with provenance)
 * - Year-by-year projected financials
 * - DCF / intrinsic valuation
 * - Operating bridge vs base case
 * - Sensitivity tables
 * - Warnings for any skipped calculations
 */
export function runScenarioAnalysis(
  base: BaseCompanyData,
  scenarios: ScenarioConfig[],
): ScenarioOutput {
  const allWarnings: string[] = [];

  // --- Base case DCF (for comparison) ---
  let baseValuation: ScenarioOutput["baseValuation"];
  if (base.fcf != null && base.discountRate != null && base.terminalGrowthRate != null) {
    // Build a base-case projection (no adjustments) for comparison
    const baseProjected: ProjectedYear[] = [];
    const growthRate = base.fcfGrowthRate ?? 0;
    let prevRevenue = base.revenue;
    for (let y = 0; y <= 5; y++) {
      const rev = y === 0 ? base.revenue : prevRevenue * (1 + growthRate);
      const fcf = y === 0 ? base.fcf : base.fcf! * (1 + growthRate) ** y;
      baseProjected.push({ year: y, revenue: rev, fcf });
      prevRevenue = rev;
    }
    const baseDcf = computeScenarioDcf(baseProjected, base, {
      discountRate: base.discountRate,
      terminalGrowthRate: base.terminalGrowthRate,
    });
    baseValuation = {
      dcfPerShare: baseDcf.intrinsicValuePerShare,
      price: base.price,
      marginOfSafety: baseDcf.marginOfSafety,
    };
  }

  // --- Run each scenario ---
  const results: ScenarioResult[] = [];

  for (const scenario of scenarios) {
    const scenarioWarnings: string[] = [];

    // 1. Build transition path
    const transition = scenario.transitionPath ?? { years: 5, annual: buildTransitionPath(scenario.company, 5) };

    // 2. Project year-by-year financials
    const { years: projected, warnings: projWarnings } = projectFinancials(
      base, scenario.company, transition,
    );
    scenarioWarnings.push(...projWarnings);

    // 3. DCF valuation
    const dcf = computeScenarioDcf(projected, base, scenario.macro);
    scenarioWarnings.push(...dcf.warnings);

    // 4. Operating bridge
    const bridge = buildBridge(base, projected, dcf);

    // 5. Sensitivity analysis
    const sensitivity = computeSensitivity(projected, base, scenario.macro);

    // 6. Package assumptions
    const assumptions = packageAssumptions(scenario.macro, scenario.company);

    // 7. FX-adjusted valuation (when FX data is available)
    let fxResult: ScenarioResult["fx"];
    if (base.fxRate && base.unitSystem === "rial" && dcf.intrinsicValuePerShare) {
      fxResult = {
        path: scenario.macro.fxPath ?? [base.fxRate],
        baseFxPath: scenario.fx?.baseFxPath,
        usdIntrinsicValue: dcf.intrinsicValuePerShare / base.fxRate,
      };
    }

    // 8. Probability weighting
    let probabilityWeightedValue: number | undefined;
    if (scenario.probability != null) {
      if (scenario.probability < 0 || scenario.probability > 1) {
        scenarioWarnings.push(`Invalid probability ${scenario.probability} — must be between 0 and 1.`);
      } else if (dcf.intrinsicValuePerShare != null) {
        probabilityWeightedValue = scenario.probability * dcf.intrinsicValuePerShare;
      }
    }

    results.push({
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      description: scenario.description,
      assumptions,
      projectedFinancials: projected,
      dcf,
      bridge,
      sensitivity,
      probability: scenario.probability,
      probabilityWeightedValue,
      fx: fxResult,
      warnings: scenarioWarnings,
    });
  }

  // --- Expected value (probability-weighted) ---
  let expectedValue: number | undefined;
  const allHaveProbabilities = results.every((r) => r.probability != null);
  if (allHaveProbabilities && results.length > 0) {
    expectedValue = results.reduce((sum, r) => sum + (r.probabilityWeightedValue ?? 0), 0);
  }

  return {
    symbol: base.symbol,
    name: base.name,
    baseCase: base,
    baseValuation,
    results,
    expectedValue,
    warnings: allWarnings,
  };
}

// ---------------------------------------------------------------------------
// Convenience: run scenarios from FundamentalInputs
// ---------------------------------------------------------------------------

/**
 * High-level entry point that converts FundamentalInputs into BaseCompanyData
 * and runs all four preset scenarios (or specified ones).
 */
export function runScenariosFromInputs(
  inputs: import("./types").FundamentalInputs,
  opts?: {
    symbol?: string;
    name?: string;
    fy?: number | null;
    fxRate?: number;
    unitSystem?: "rial" | "usd";
    scenarioIds?: MacroScenarioId[];
    customScenarios?: ScenarioConfig[];
  },
): ScenarioOutput {
  const base = buildBaseData(inputs, {
    symbol: opts?.symbol,
    name: opts?.name,
    fy: opts?.fy,
    fxRate: opts?.fxRate,
    unitSystem: opts?.unitSystem,
  });

  const scenarioIds = opts?.scenarioIds ?? (["persistent-sanctions", "partial-normalization", "full-normalization", "severe-deterioration"] as MacroScenarioId[]);
  const presets = scenarioIds.map((id) => getPreset(id));
  const allScenarios = [...presets, ...(opts?.customScenarios ?? [])];

  return runScenarioAnalysis(base, allScenarios);
}

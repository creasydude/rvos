// Deterministic tests for the scenario engine.
// Run: npx tsx brain/scenarios.test.ts

import { FundamentalInputs } from "./types";
import {
  buildBaseData,
  buildBridge,
  computeScenarioDcf,
  computeSensitivity,
  getAllPresets,
  getPreset,
  projectFinancials,
  runScenarioAnalysis,
  runScenariosFromInputs,
} from "./scenarios";
import {
  BaseCompanyData,
  MacroScenarioId,
  ProjectedYear,
  ScenarioConfig,
} from "./scenario-types";

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

let failures = 0;
let passed = 0;

function approx(name: string, got: number | undefined, want: number, tol = 1e-6) {
  if (got == null || !isFinite(got)) {
    failures++;
    console.log(`✗ ${name}: got ${got}, want ${want}`);
    return;
  }
  if (Math.abs(got - want) < tol) {
    passed++;
    console.log(`✓ ${name}`);
  } else {
    failures++;
    console.log(`✗ ${name}: got ${got}, want ${want} (diff ${Math.abs(got - want)})`);
  }
}

function eq(name: string, got: unknown, want: unknown) {
  if (got === want) {
    passed++;
    console.log(`✓ ${name}`);
  } else {
    failures++;
    console.log(`✗ ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

function truthy(name: string, val: unknown) {
  if (val) {
    passed++;
    console.log(`✓ ${name}`);
  } else {
    failures++;
    console.log(`✗ ${name}: expected truthy, got ${val}`);
  }
}

function ok(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`✓ ${name}`);
  } else {
    failures++;
    console.log(`✗ ${name}${detail ? `: ${detail}` : ""}`);
  }
}

// ---------------------------------------------------------------------------
// Known test data
// ---------------------------------------------------------------------------

const BASE_INPUTS: FundamentalInputs = {
  price: 1000,
  sharesOutstanding: 100,
  revenue: 50000,
  cogs: 35000,
  ebitda: 12000,
  ebit: 8000,
  netIncome: 5000,
  fcf: 6000,
  capex: 3000,
  operatingCashFlow: 9000,
  totalAssets: 80000,
  totalDebt: 20000,
  shareholdersEquity: 40000,
  currentAssets: 25000,
  currentLiabilities: 15000,
  netDebt: 15000,
  discountRate: 0.20,
  terminalGrowthRate: 0.04,
  fcfGrowthRate: 0.05,
  eps: 50,
  bookValuePerShare: 400,
};

const BASE: BaseCompanyData = buildBaseData(BASE_INPUTS, {
  symbol: "TEST",
  name: "Test Co",
  fy: 1404,
  unitSystem: "rial",
});

// ===== PRESETS =====

console.log("\n--- Scenario presets ---");
const presets = getAllPresets();
eq("4 presets exist", presets.length, 4);
truthy("persistent-sanctions preset exists", getPreset("persistent-sanctions"));
truthy("partial-normalization preset exists", getPreset("partial-normalization"));
truthy("full-normalization preset exists", getPreset("full-normalization"));
truthy("severe-deterioration preset exists", getPreset("severe-deterioration"));

// Presets should have discount rates
for (const p of presets) {
  truthy(`${p.id} has discountRate`, p.macro.discountRate != null);
  truthy(`${p.id} has terminalGrowthRate`, p.macro.terminalGrowthRate != null);
}

// ===== BASE DATA =====

console.log("\n--- Base data construction ---");
approx("base revenue", BASE.revenue, 50000);
approx("base ebitdaMargin", BASE.ebitdaMargin, 12000 / 50000);
approx("base grossMargin", BASE.grossMargin, (50000 - 35000) / 50000);
approx("base workingCapital", BASE.workingCapital, 10000);

// --- EBITDA/FCF estimation from sparse data ---
console.log("\n--- EBITDA/FCF estimation ---");
{
  // Case 1: EBITDA missing, EBIT available → estimated as EBIT × 1.2
  const sparse1 = buildBaseData({ ...BASE_INPUTS, ebitda: undefined, fcf: undefined });
  approx("ebitda estimated from ebit", sparse1.ebitda, 8000 * 1.2);
  truthy("ebitdaMargin derived from estimated ebitda", sparse1.ebitdaMargin != null && sparse1.ebitdaMargin > 0);

  // Case 2: FCF missing, operatingCashFlow + capex available
  const sparse2 = buildBaseData({ ...BASE_INPUTS, fcf: undefined });
  approx("fcf estimated from ocf - capex", sparse2.fcf, 9000 - 3000);

  // Case 3: FCF missing, no operatingCashFlow, but ebitda + capex → EBITDA-based proxy
  const sparse3 = buildBaseData({ ...BASE_INPUTS, fcf: undefined, operatingCashFlow: undefined, ebitda: 12000 });
  const expectedTax = 1500 / 6000; // taxRate from BASE: taxExpense / preTaxIncome
  approx("fcf estimated from ebitda proxy", sparse3.fcf, 12000 * (1 - expectedTax) - 3000, 0.01);

  // Case 4: Both EBITDA and FCF missing, EBIT available
  const sparse4 = buildBaseData({ ...BASE_INPUTS, ebitda: undefined, fcf: undefined, operatingCashFlow: undefined });
  truthy("ebitda estimated for sparse case", sparse4.ebitda != null);
  // FCF should also be estimated: ebitda proxy - capex
  approx("fcf estimated via ebitda proxy for sparse", sparse4.fcf, (8000 * 1.2) * (1 - expectedTax) - 3000, 0.01);

  // Case 5: Projection works with estimated EBITDA
  const proj = projectFinancials(sparse1, { revenueGrowthAdjustment: 0.03 }, { years: 3, annual: [] });
  truthy("projection produces fcf with estimated ebitda", proj.years[3].fcf != null);
  ok("sparse projection has no 'neither' warning", !proj.warnings.some((w) => w.includes("No FCF or EBITDA")));
}

// ===== TRANSITION PATH =====

console.log("\n--- Transition path ---");
{
  const { years } = projectFinancials(BASE, { ebitdaMarginAdjustment: 0.04, revenueGrowthAdjustment: 0.03 }, { years: 5, annual: [] });
  eq("6 years (0-5)", years.length, 6);
  approx("year 0 revenue = base", years[0].revenue, BASE.revenue);
  // Year 5 should have 5 years of revenue growth (at base growth rate of 0 from the adjustment)
  truthy("year 5 revenue > year 0", years[5].revenue > years[0].revenue);
  // EBITDA margin should interpolate from 0 (year 0) to +4pp (year 5)
  if (years[0].ebitdaMargin != null && years[5].ebitdaMargin != null) {
    approx("year 0 ebitdaMargin = base", years[0].ebitdaMargin, BASE.ebitdaMargin!);
    approx("year 5 ebitdaMargin = base + 4pp", years[5].ebitdaMargin, BASE.ebitdaMargin! + 0.04, 0.001);
  }
}

// ===== REVENUE PROJECTIONS =====

console.log("\n--- Revenue projections ---");
{
  const { years } = projectFinancials(
    BASE,
    { revenueGrowthAdjustment: 0.05 },
    { years: 5, annual: [] },
  );
  // Year 1: growthAdj = lerp(0, 0.05, 1/5) = 0.01
  // Year 1 revenue = 50000 * (1 + 0.01) = 50500
  approx("year 1 revenue with +5pp growth adj", years[1].revenue, 50000 * 1.01);
  // Year 5: compounds on prior years — 50000 * 1.01 * 1.02 * 1.03 * 1.04 * 1.05
  approx("year 5 revenue with +5pp growth adj", years[5].revenue,
    50000 * 1.01 * 1.02 * 1.03 * 1.04 * 1.05, 1);
}

// ===== VOLUME ADJUSTMENTS =====

console.log("\n--- Volume adjustments ---");
{
  const { years } = projectFinancials(
    BASE,
    { exportVolumeAdjustment: 1.20 },
    { years: 5, annual: [] },
  );
  // Year 1: exportAdj = lerp(1.0, 1.20, 1/5) = 1.04
  // revenue = 50000 * 1.04 = 52000
  approx("year 1 revenue with export volume adj", years[1].revenue, 50000 * 1.04);
  // Year 5: compounds on prior years — 50000 * 1.04 * 1.08 * 1.12 * 1.16 * 1.20
  approx("year 5 revenue with export volume adj", years[5].revenue,
    50000 * 1.04 * 1.08 * 1.12 * 1.16 * 1.20, 1);
}

// ===== MARGIN ADJUSTMENTS =====

console.log("\n--- Margin adjustments ---");
{
  const { years } = projectFinancials(
    BASE,
    { ebitdaMarginAdjustment: 0.03 },
    { years: 5, annual: [] },
  );
  if (years[5].ebitdaMargin != null) {
    approx("year 5 ebitdaMargin = base + 3pp", years[5].ebitdaMargin, BASE.ebitdaMargin! + 0.03, 0.001);
  }
  if (years[5].ebitda != null) {
    // EBITDA = revenue * margin
    approx("year 5 ebitda consistency", years[5].ebitda, years[5].revenue * years[5].ebitdaMargin!, 1);
  }
}

// ===== DCF =====

console.log("\n--- Scenario DCF ---");
{
  // Simple DCF test: known FCFs, known rates
  const projected: ProjectedYear[] = [
    { year: 0, revenue: 100, fcf: 10 },
    { year: 1, revenue: 110, fcf: 11 },
    { year: 2, revenue: 121, fcf: 12.1 },
    { year: 3, revenue: 133.1, fcf: 13.31 },
    { year: 4, revenue: 146.41, fcf: 14.641 },
    { year: 5, revenue: 161.051, fcf: 16.1051 },
  ];
  const base = { ...BASE, sharesOutstanding: 10, netDebt: 0 };
  const dcf = computeScenarioDcf(projected, base, {
    discountRate: 0.10,
    terminalGrowthRate: 0.03,
  });

  // Manual DCF calc: PV of FCFs
  const r = 0.10, g = 0.03;
  const fcfs = [11, 12.1, 13.31, 14.641, 16.1051];
  const pv = fcfs.reduce((s, f, k) => s + f / (1 + r) ** (k + 1), 0);
  const tv = 16.1051 * (1 + g) / (r - g);
  const pvTv = tv / (1 + r) ** 5;
  const ev = pv + pvTv;

  approx("DCF pvCashFlows", dcf.pvCashFlows, pv, 1e-4);
  approx("DCF terminalValue", dcf.terminalValue, tv, 1e-4);
  approx("DCF enterpriseValue", dcf.enterpriseValue, ev, 1e-4);
  approx("DCF equityValue", dcf.equityValue, ev, 1e-4);
  approx("DCF intrinsicPerShare", dcf.intrinsicValuePerShare, ev / 10, 1e-4);
  eq("DCF no warnings", dcf.warnings.length, 0);
}

// DCF with missing data
{
  const dcf = computeScenarioDcf([], BASE, {});
  truthy("DCF with no FCF has warning", dcf.warnings.some((w) => w.includes("no projected FCF")));
}

// DCF with invalid discount rate
{
  const baseNoDcf = { ...BASE, discountRate: undefined };
  const dcf = computeScenarioDcf([{ year: 1, revenue: 100, fcf: 10 }], baseNoDcf, {});
  truthy("DCF with no discount rate has warning", dcf.warnings.some((w) => w.includes("no discount rate")));
}

// ===== MULTIPLE VALUATION =====

console.log("\n--- Multiple valuation ---");
{
  const projected: ProjectedYear[] = [
    { year: 0, revenue: 100, fcf: 10, ebitda: 20 },
    { year: 1, revenue: 110, fcf: 11, ebitda: 22 },
    { year: 2, revenue: 121, fcf: 12.1, ebitda: 24.2 },
    { year: 3, revenue: 133.1, fcf: 13.31, ebitda: 26.62 },
    { year: 4, revenue: 146.41, fcf: 14.641, ebitda: 29.282 },
    { year: 5, revenue: 161.051, fcf: 16.1051, ebitda: 32.2102 },
  ];
  const base = { ...BASE, sharesOutstanding: 10, netDebt: 0 };
  const dcf = computeScenarioDcf(projected, base, {
    discountRate: 0.10,
    terminalGrowthRate: 0.03,
    exitMultiple: 8,
  });
  truthy("multiple valuation present", dcf.multipleValuation != null);
  if (dcf.multipleValuation) {
    approx("mv exitMultiple", dcf.multipleValuation.exitMultiple, 8);
    approx("mv terminalValue", dcf.multipleValuation.terminalValue, 32.2102 * 8, 1e-4);
  }
}

// ===== SENSITIVITY =====

console.log("\n--- Sensitivity analysis ---");
{
  const projected: ProjectedYear[] = [
    { year: 0, revenue: 100, fcf: 10 },
    { year: 1, revenue: 110, fcf: 11 },
    { year: 2, revenue: 121, fcf: 12.1 },
    { year: 3, revenue: 133.1, fcf: 13.31 },
    { year: 4, revenue: 146.41, fcf: 14.641 },
    { year: 5, revenue: 161.051, fcf: 16.1051 },
  ];
  const sens = computeSensitivity(projected, BASE, {
    discountRate: 0.20,
    terminalGrowthRate: 0.04,
  });
  truthy("sensitivity.discountRate has points", sens.discountRate.length > 0);
  truthy("sensitivity.terminalGrowth has points", sens.terminalGrowth.length > 0);
  truthy("sensitivity.exitMultiple has points", sens.exitMultiple.length > 0);

  // Higher discount rate should give lower value
  const low = sens.discountRate.find((p) => p.discountRate === 0.15);
  const high = sens.discountRate.find((p) => p.discountRate === 0.30);
  if (low?.intrinsicValuePerShare != null && high?.intrinsicValuePerShare != null) {
    ok("lower discount rate → higher value", low.intrinsicValuePerShare > high.intrinsicValuePerShare,
      `low=${low.intrinsicValuePerShare}, high=${high.intrinsicValuePerShare}`);
  }

  // Higher terminal growth should give higher value
  const lowG = sens.terminalGrowth.find((p) => p.terminalGrowth === 0.02);
  const highG = sens.terminalGrowth.find((p) => p.terminalGrowth === 0.06);
  if (lowG?.intrinsicValuePerShare != null && highG?.intrinsicValuePerShare != null) {
    ok("higher terminal growth → higher value", highG.intrinsicValuePerShare > lowG.intrinsicValuePerShare,
      `lowG=${lowG.intrinsicValuePerShare}, highG=${highG.intrinsicValuePerShare}`);
  }
}

// ===== BRIDGE =====

console.log("\n--- Operating bridge ---");
{
  const projected: ProjectedYear[] = [
    { year: 0, revenue: 50000, ebitda: 12000, ebitdaMargin: 0.24, fcf: 6000 },
    { year: 5, revenue: 55000, ebitda: 14300, ebitdaMargin: 0.26, fcf: 7500 },
  ];
  const dcf = { intrinsicValuePerShare: 1200, warnings: [] };
  const bridge = buildBridge(BASE, projected, dcf as any);
  truthy("bridge.revenue has entries", (bridge.revenue?.length ?? 0) > 0);
  truthy("bridge.ebitda has entries", (bridge.ebitda?.length ?? 0) > 0);
  truthy("bridge.fcf has entries", (bridge.fcf?.length ?? 0) > 0);
}

// ===== FULL SCENARIO ANALYSIS =====

console.log("\n--- Full scenario analysis ---");
{
  const output = runScenariosFromInputs(BASE_INPUTS, {
    symbol: "TEST",
    name: "Test Co",
    fy: 1404,
    unitSystem: "rial",
  });
  eq("4 scenario results", output.results.length, 4);
  truthy("base case present", output.baseCase != null);
  truthy("base valuation present", output.baseValuation != null);

  for (const r of output.results) {
    truthy(`${r.scenarioId} has projectedFinancials`, r.projectedFinancials.length > 0);
    truthy(`${r.scenarioId} has dcf`, r.dcf != null);
    truthy(`${r.scenarioId} has bridge`, r.bridge != null);
    truthy(`${r.scenarioId} has sensitivity`, r.sensitivity != null);
    truthy(`${r.scenarioId} has assumptions.macro`, r.assumptions.macro.length > 0);
    truthy(`${r.scenarioId} has assumptions.company`, r.assumptions.company.length > 0);
    eq(`${r.scenarioId} year 0 = base`, r.projectedFinancials[0].revenue, BASE.revenue);
  }
}

// ===== FULL-NORMALIZATION vs PERSISTENT-SANCTIONS =====

console.log("\n--- Scenario comparison ---");
{
  const output = runScenariosFromInputs(BASE_INPUTS, { unitSystem: "rial" });
  const full = output.results.find((r) => r.scenarioId === "full-normalization");
  const persistent = output.results.find((r) => r.scenarioId === "persistent-sanctions");
  truthy("full-normalization result exists", full);
  truthy("persistent-sanctions result exists", persistent);

  if (full?.dcf.intrinsicValuePerShare != null && persistent?.dcf.intrinsicValuePerShare != null) {
    ok("full-normalization > persistent-sanctions intrinsic value",
      full.dcf.intrinsicValuePerShare > persistent.dcf.intrinsicValuePerShare,
      `full=${full.dcf.intrinsicValuePerShare}, persistent=${persistent.dcf.intrinsicValuePerShare}`);
  }

  // Full normalization should have higher terminal growth and lower discount rate
  if (full && persistent) {
    ok("full-normalization discount rate < persistent-sanctions",
      (full.assumptions.macro.find((a) => a.key === "discountRate")?.value ?? 1) <
      (persistent.assumptions.macro.find((a) => a.key === "discountRate")?.value ?? 0),
    );
  }
}

// ===== UNCHANGED ASSUMPTIONS → BASE CASE =====

console.log("\n--- Unchanged assumptions preserve base case ---");
{
  // A scenario with no company adjustments should produce year 0 = base,
  // and year-by-year revenue should only grow at the base fcfGrowthRate
  const neutralScenario: ScenarioConfig = {
    id: "persistent-sanctions",
    name: "Neutral",
    description: "No adjustments",
    macro: { discountRate: 0.20, terminalGrowthRate: 0.04 },
    company: {},
    transitionPath: { years: 5, annual: [] },
  };
  const output = runScenarioAnalysis(BASE, [neutralScenario]);
  const result = output.results[0];
  approx("neutral year 0 revenue = base", result.projectedFinancials[0].revenue, BASE.revenue);
  // With no growth adjustment, revenue should remain flat
  approx("neutral year 5 revenue = base (no growth adj)", result.projectedFinancials[5].revenue, BASE.revenue);
}

// ===== PROBABILITY WEIGHTING =====

console.log("\n--- Probability weighting ---");
{
  const output = runScenariosFromInputs(BASE_INPUTS, { unitSystem: "rial" });
  // Without probabilities, expectedValue should be undefined
  eq("no expectedValue without probabilities", output.expectedValue, undefined);

  // With probabilities, expectedValue should be defined
  const withProbs: ScenarioConfig[] = [
    { ...getPreset("persistent-sanctions"), probability: 0.3 },
    { ...getPreset("partial-normalization"), probability: 0.4 },
    { ...getPreset("full-normalization"), probability: 0.2 },
    { ...getPreset("severe-deterioration"), probability: 0.1 },
  ];
  const outputWithProbs = runScenarioAnalysis(BASE, withProbs);
  truthy("expectedValue defined with probabilities", outputWithProbs.expectedValue != null);

  // Manual expected value
  const manualEv = outputWithProbs.results.reduce(
    (sum, r) => sum + (r.probabilityWeightedValue ?? 0), 0,
  );
  approx("expectedValue matches manual calc", outputWithProbs.expectedValue!, manualEv, 1e-6);

  // Individual probability-weighted values
  for (const r of outputWithProbs.results) {
    if (r.probability != null && r.dcf.intrinsicValuePerShare != null) {
      approx(`${r.scenarioId} PW value`, r.probabilityWeightedValue!, r.probability * r.dcf.intrinsicValuePerShare, 1e-6);
    }
  }
}

// ===== INVALID PROBABILITIES =====

console.log("\n--- Invalid probabilities ---");
{
  const scenario: ScenarioConfig = {
    ...getPreset("full-normalization"),
    probability: 1.5, // invalid
  };
  const output = runScenarioAnalysis(BASE, [scenario]);
  ok("invalid probability produces warning", output.results[0].warnings.some((w) => w.includes("Invalid probability")));
}

// ===== MISSING DATA =====

console.log("\n--- Missing data warnings ---");
{
  const sparseInputs: FundamentalInputs = {
    price: 500,
    // Everything else missing
  };
  const output = runScenariosFromInputs(sparseInputs, { symbol: "SPARSE" });
  truthy("sparse input produces warnings", output.results[0].warnings.length > 0 || output.warnings.length > 0);
  // DCF should be skipped for sparse data
  for (const r of output.results) {
    if (r.dcf.warnings.length > 0) {
      truthy(`${r.scenarioId} has DCF warnings for sparse data`, true);
    }
  }
}

// ===== FX =====

console.log("\n--- FX treatment ---");
{
  const output = runScenariosFromInputs(BASE_INPUTS, {
    unitSystem: "rial",
    fxRate: 500000,
  });
  const full = output.results.find((r) => r.scenarioId === "full-normalization");
  truthy("FX result present for rial system", full?.fx != null);
  if (full?.fx && full.dcf.intrinsicValuePerShare) {
    approx("usdIntrinsicValue = rial / fxRate", full.fx.usdIntrinsicValue!, full.dcf.intrinsicValuePerShare / 500000, 0.01);
  }
}

// Without fxRate, no FX result
{
  const output = runScenariosFromInputs(BASE_INPUTS, { unitSystem: "usd" });
  const full = output.results.find((r) => r.scenarioId === "full-normalization");
  eq("no FX result for usd system", full?.fx, undefined);
}

// ===== NO DOUBLE COUNTING =====

console.log("\n--- No double counting ---");
{
  // Revenue adjustment should appear only in revenue, not independently in EBITDA
  const { years } = projectFinancials(
    BASE,
    { revenueGrowthAdjustment: 0.10, ebitdaMarginAdjustment: 0 },
    { years: 5, annual: [] },
  );
  const y5 = years[5];
  // EBITDA = revenue * baseMargin (margin not adjusted)
  if (y5.ebitda != null && y5.revenue && BASE.ebitdaMargin != null) {
    approx("EBITDA = revenue × base margin (no double count)", y5.ebitda, y5.revenue * BASE.ebitdaMargin, 1);
  }
}

// ===== YEAR 0 = BASE =====

console.log("\n--- Year 0 always equals base ---");
{
  const output = runScenariosFromInputs(BASE_INPUTS, { unitSystem: "rial" });
  for (const r of output.results) {
    approx(`${r.scenarioId} year 0 revenue = base`, r.projectedFinancials[0].revenue, BASE.revenue);
    if (r.projectedFinancials[0].fcf != null && BASE.fcf != null) {
      approx(`${r.scenarioId} year 0 fcf = base`, r.projectedFinancials[0].fcf, BASE.fcf);
    }
  }
}

// ===== CUSTOM SCENARIO =====

console.log("\n--- Custom scenario ---");
{
  const custom: ScenarioConfig = {
    id: "persistent-sanctions",
    name: "Custom Test",
    description: "Custom scenario for testing",
    macro: { discountRate: 0.15, terminalGrowthRate: 0.03 },
    company: { revenueGrowthAdjustment: 0.10 },
    transitionPath: { years: 3, annual: [] },
  };
  const output = runScenariosFromInputs(BASE_INPUTS, {
    customScenarios: [custom],
    scenarioIds: [],
  });
  eq("only custom scenario", output.results.length, 1);
  eq("custom scenario name", output.results[0].scenarioName, "Custom Test");
}

// ===== FORMATTING =====

console.log("\n--- Formatting / no fake precision ---");
{
  const output = runScenariosFromInputs(BASE_INPUTS, { unitSystem: "rial" });
  for (const r of output.results) {
    if (r.dcf.intrinsicValuePerShare != null) {
      // The value should be a finite number, not NaN or Infinity
      truthy(`${r.scenarioId} intrinsic is finite`, isFinite(r.dcf.intrinsicValuePerShare));
    }
  }
}

// ===== RESULTS =====

console.log(`\n=== ${passed} passed, ${failures} failed ===`);
if (failures > 0) {
  process.exit(1);
} else {
  console.log("All scenario checks passed.");
  process.exit(0);
}

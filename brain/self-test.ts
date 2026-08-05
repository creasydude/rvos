// Quick sanity checks for the brain. Run: npm run brain:test
import { analyzeFundamental } from "./fundamental";
import { analyzeTechnical } from "./technical";
import { Calc, FundamentalInputs } from "./types";

let failures = 0;
function approx(name: string, got: number, want: number, tol = 1e-9) {
  const ok = Math.abs(got - want) < tol;
  if (!ok) {
    failures++;
    console.log(`✗ ${name}: got ${got}, want ${want}`);
  } else {
    console.log(`✓ ${name}`);
  }
}
function get(calcs: Calc[], name: string): Calc | undefined {
  return calcs.find((c) => c.name === name);
}

// ---- Fundamental: known figures for a clean sanity check ----
const F: FundamentalInputs = {
  price: 100,
  sharesOutstanding: 10,
  eps: 5,
  bookValuePerShare: 20,
  salesPerShare: 50,
  pePeer: 15,
  pbPeer: 3,
  psPeer: 1.5,
  ev: 1200,
  ebitda: 200,
  evEbitdaPeer: 10,
  netIncome: 50,
  revenue: 500,
  totalAssets: 1000,
  shareholdersEquity: 400,
  totalLiabilities: 600,
  retainedEarnings: 100,
  ebit: 80,
  currentAssets: 200,
  currentLiabilities: 150,
  fcf: 60,
  fcfGrowthRate: 0.05,
  discountRate: 0.1,
  terminalGrowthRate: 0.03,
  netDebt: 200,
  dividendsPerShare: 1,
  dividendGrowthRate: 0.04,
};
const res = analyzeFundamental(F);
approx("P/E", get(res.calcs, "P/E")!.value, 20);
approx("P/E vs peer premium", get(res.calcs, "P/E vs peer premium")!.value, (20 - 15) / 15 * 100);
approx("EV/EBITDA", get(res.calcs, "EV/EBITDA")!.value, 6);
approx("P/B", get(res.calcs, "P/B")!.value, 5);
approx("P/S", get(res.calcs, "P/S")!.value, 2);
approx("Graham Number", get(res.calcs, "Graham Number")!.value, Math.sqrt(22.5 * 5 * 20));
approx("Graham margin of safety", get(res.calcs, "Graham margin of safety")!.value, (Math.sqrt(22.5 * 5 * 20) / 100 - 1) * 100);
approx("DDM intrinsic", get(res.calcs, "DDM intrinsic (Gordon)")!.value, 1 * 1.04 / (0.1 - 0.04));
approx("ROE (DuPont)", get(res.calcs, "ROE (DuPont)")!.value, (50 / 500) * (500 / 1000) * (1000 / 400) * 100);
// DCF: 5-year projection at 5% growth from 60 FCF, r=10%, g=3%
const proj = Array.from({ length: 5 }, (_, k) => 60 * 1.05 ** (k + 1));
const pv = proj.reduce((s, f, k) => s + f / 1.1 ** (k + 1), 0);
const tv = proj[4] * 1.03 / (0.1 - 0.03);
const evExpected = pv + tv / 1.1 ** 5;
approx("DCF EV", get(res.calcs, "DCF enterprise value")!.value, evExpected, 1e-6);
approx("DCF per share", get(res.calcs, "DCF intrinsic per share")!.value, (evExpected - 200) / 10, 1e-6);
approx("FCF yield", get(res.calcs, "FCF yield")!.value, 60 / (100 * 10) * 100);
// Altman Z for our figures: A=0.05, B=0.1, C=0.08, D=1000/600, E=0.5
approx("Altman Z-Score", get(res.calcs, "Altman Z-Score")!.value, 1.2 * 0.05 + 1.4 * 0.1 + 3.3 * 0.08 + 0.6 * (1000 / 600) + 1.0 * 0.5);

// ---- F-Score needs prior-year data; without it, skipped ----
const noPrior = analyzeFundamental({ ...F });
if (get(noPrior.calcs, "Piotroski F-Score")) { failures++; console.log("✗ F-Score should be skipped without prior year"); }
else console.log("✓ F-Score skipped without prior-year data");

// ---- Technical: known synthetic series ----
// RSI sanity: strictly rising series → RSI near 100; falling → near 0.
const rising = Array.from({ length: 50 }, (_, i) => 100 + i);
const r = analyzeTechnical({ close: rising });
approx("RSI on monotonic rise", get(r.calcs, "RSI(14)")!.value, 100, 1e-6);
// Z-score on the linear series 0..49: last point = 49, mean20 = mean(30..49), std20 computed
{
  const lin = Array.from({ length: 50 }, (_, i) => i);
  const tr = analyzeTechnical({ close: lin });
  const z = get(tr.calcs, "Price Z-score(20)")!.value;
  const slice = lin.slice(30, 50);
  const m = slice.reduce((a, b) => a + b, 0) / 20;
  const sd = Math.sqrt(slice.reduce((a, b) => a + (b - m) ** 2, 0) / 20);
  approx("Price Z-score(20)", z, (49 - m) / sd, 1e-6);
}
// SMA check: last SMA20 of rising series = mean of last 20
const smaRes = analyzeTechnical({ close: Array.from({ length: 50 }, (_, i) => i) });
const lastSma20 = get(smaRes.calcs, "Price above SMA20") || get(smaRes.calcs, "Price below SMA20");
if (!lastSma20) { failures++; console.log("✗ missing SMA20 calc"); }
else {
  const close = Array.from({ length: 50 }, (_, i) => i);
  const mean20 = close.slice(30, 50).reduce((a, b) => a + b, 0) / 20;
  const expectedPct = (close[49] - mean20) / mean20 * 100;
  approx("SMA20 spread", lastSma20.value, expectedPct, 1e-6);
}

if (failures === 0) {
  console.log("\nAll brain checks passed.");
  process.exit(0);
} else {
  console.log(`\n${failures} check(s) failed.`);
  process.exit(1);
}

// Pure, unit-testable fundamental valuation math. No LLM, no IO.
// Every Calc carries its inputs so the caller can trace numbers to sources.

import { Calc, FundamentalInputs, FundamentalResult, Input, num, PriorFundamentalInputs } from "./types";

function i(name: string, value: number | string | undefined | null, source: Input["source"] = "fundamental"): Input | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return { name, value, source };
  if (!isFinite(value)) return null;
  return { name, value: String(num(value, 4) ?? value), source };
}

function calc(name: string, value: number, formula: string, inputs: (Input | null)[], unit?: Calc["unit"]): Calc {
  return { name, value, unit, formula, inputs: inputs.filter((x): x is Input => x !== null) };
}

export function analyzeFundamental(inp: FundamentalInputs, prior?: PriorFundamentalInputs): FundamentalResult {
  const calcs: Calc[] = [];
  const warnings: string[] = [];

  const marketCap = inp.marketCap ?? (inp.price && inp.sharesOutstanding ? inp.price * inp.sharesOutstanding : undefined);

  // ---- Valuation multiples vs peers --------------------------------------
  if (inp.price != null && inp.eps) {
    const pe = inp.price / inp.eps;
    calcs.push(calc("P/E", pe, "price / eps", [i("price", inp.price), i("eps", inp.eps)], "x"));
    if (inp.pePeer) {
      const prem = (pe - inp.pePeer) / inp.pePeer * 100;
      calcs.push(calc("P/E vs peer premium", prem, "(pe - peer_pe) / peer_pe * 100", [i("peer P/E", inp.pePeer), i("P/E", pe)], "%"));
    }
  } else warnings.push("P/E skipped: need price and EPS");

  if (inp.ev != null && inp.ebitda) {
    const evEbitda = inp.ev / inp.ebitda;
    calcs.push(calc("EV/EBITDA", evEbitda, "ev / ebitda", [i("EV", inp.ev), i("EBITDA", inp.ebitda)], "x"));
    if (inp.evEbitdaPeer) {
      calcs.push(calc(
        "EV/EBITDA vs peer premium",
        (evEbitda - inp.evEbitdaPeer) / inp.evEbitdaPeer * 100,
        "(ev_ebitda - peer) / peer * 100",
        [i("peer EV/EBITDA", inp.evEbitdaPeer), i("EV/EBITDA", evEbitda)],
      ));
    }
  } else warnings.push("EV/EBITDA skipped: need EV and EBITDA");

  if (inp.price != null && inp.bookValuePerShare) {
    const pb = inp.price / inp.bookValuePerShare;
    calcs.push(calc("P/B", pb, "price / book_value_per_share", [i("price", inp.price), i("BVPS", inp.bookValuePerShare)], "x"));
    if (inp.pbPeer) {
      calcs.push(calc(
        "P/B vs peer premium",
        (pb - inp.pbPeer) / inp.pbPeer * 100,
        "(pb - peer) / peer * 100",
        [i("peer P/B", inp.pbPeer), i("P/B", pb)],
      ));
    }
  } else warnings.push("P/B skipped: need price and book value per share");

  if (inp.price != null && inp.salesPerShare) {
    const ps = inp.price / inp.salesPerShare;
    calcs.push(calc("P/S", ps, "price / sales_per_share", [i("price", inp.price), i("SPS", inp.salesPerShare)], "x"));
    if (inp.psPeer) {
      calcs.push(calc(
        "P/S vs peer premium",
        (ps - inp.psPeer) / inp.psPeer * 100,
        "(ps - peer) / peer * 100",
        [i("peer P/S", inp.psPeer), i("P/S", ps)],
      ));
    }
  } else warnings.push("P/S skipped: need price and sales per share");

  // ---- Graham number & margin of safety -----------------------------------
  if (inp.eps && inp.bookValuePerShare) {
    const graham = Math.sqrt(22.5 * inp.eps * inp.bookValuePerShare);
    calcs.push(calc("Graham Number", graham, "sqrt(22.5 * eps * bvps)", [i("eps", inp.eps), i("BVPS", inp.bookValuePerShare)], "usd-per-share"));
    if (inp.price) {
      calcs.push(calc(
        "Graham margin of safety",
        (graham / inp.price - 1) * 100,
        "(graham / price - 1) * 100",
        [i("Graham Number", graham), i("price", inp.price)],
      ));
    }
  } else warnings.push("Graham Number skipped: need EPS and book value per share");

  // ---- Dividend Discount Model (Gordon Growth) ---------------------------
  if (inp.dividendsPerShare && inp.discountRate && inp.dividendGrowthRate != null) {
    const r = inp.discountRate, g = inp.dividendGrowthRate;
    if (r > g) {
      const value = inp.dividendsPerShare * (1 + g) / (r - g);
      calcs.push(calc("DDM intrinsic (Gordon)", value, "dps * (1+g) / (r-g)", [
        i("dividend/share", inp.dividendsPerShare),
        i("growth g", g),
        i("discount r", r),
      ], "usd-per-share"));
      if (inp.price) {
        calcs.push(calc(
          "DDM margin of safety",
          (value / inp.price - 1) * 100,
          "(ddm_value / price - 1) * 100",
          [i("DDM value", value), i("price", inp.price)],
          "%",
        ));
      }
    } else {
      warnings.push("DDM skipped: growth rate (g) must be below discount rate (r)");
    }
  } else warnings.push("DDM skipped: need dividends per share, discount rate and dividend growth rate");

  // ---- DCF ----------------------------------------------------------------
  if (inp.discountRate) {
    const r = inp.discountRate;
    const years = 5;
    const projections: number[] = inp.fcfProjection ?? (inp.fcf && inp.fcfGrowthRate != null
      ? Array.from({ length: years }, (_, k) => inp.fcf! * (1 + inp.fcfGrowthRate!) ** (k + 1))
      : []);
    if (projections.length > 0 && inp.terminalGrowthRate != null) {
      const g = inp.terminalGrowthRate;
      if (r > g) {
        const pv = projections.reduce((sum, fcf, k) => sum + fcf / (1 + r) ** (k + 1), 0);
        const tv = projections[projections.length - 1] * (1 + g) / (r - g);
        const pvTv = tv / (1 + r) ** projections.length;
        const ev = pv + pvTv;
        const netDebt = inp.netDebt ?? (inp.totalDebt && inp.totalLiabilities ? undefined : inp.totalDebt) ?? 0;
        const equity = ev - netDebt;
        const perShare = inp.sharesOutstanding ? equity / inp.sharesOutstanding : undefined;
        calcs.push(calc("DCF enterprise value", ev, "Σ fcf/(1+r)^t + tv/(1+r)^T", [
          i("discount r", r),
          i("terminal growth g", g),
          i("FCF projection", JSON.stringify(projections.slice(0, 3))),
        ], "usd"));
        if (perShare != null) {
          calcs.push(calc("DCF intrinsic per share", perShare, "(ev - net_debt) / shares", [
            i("EV", ev), i("net debt", netDebt), i("shares", inp.sharesOutstanding),
          ], "usd-per-share"));
          if (inp.price) {
            calcs.push(calc(
              "DCF margin of safety",
              (perShare / inp.price - 1) * 100,
              "(dcf_value / price - 1) * 100",
              [i("DCF value", perShare), i("price", inp.price)],
              "%",
            ));
          }
        }
      } else warnings.push("DCF skipped: terminal growth rate must be below discount rate");
    } else {
      warnings.push(
        inp.fcf && inp.fcfGrowthRate != null
          ? "DCF skipped: need terminal growth rate"
          : "DCF skipped: need FCF (or FCF growth) and terminal growth rate",
      );
    }
  } else warnings.push("DCF skipped: need a discount rate");

  // ---- FCF yield -----------------------------------------------------------
  if (inp.fcf != null && marketCap) {
    calcs.push(calc("FCF yield", inp.fcf / marketCap * 100, "fcf / market_cap * 100", [
      i("FCF", inp.fcf), i("market cap", marketCap),
    ], "%"));
  } else warnings.push("FCF yield skipped: need FCF and market cap (or shares)");

  // ---- DuPont ROE ----------------------------------------------------------
  if (inp.netIncome && inp.revenue && inp.totalAssets && inp.shareholdersEquity) {
    const pm = inp.netIncome / inp.revenue;
    const at = inp.revenue / inp.totalAssets;
    const em = inp.totalAssets / inp.shareholdersEquity;
    const roe = pm * at * em;
    calcs.push(calc("ROE (DuPont)", roe * 100, "net_margin * asset_turnover * equity_multiplier", [
      i("net income", inp.netIncome),
      i("revenue", inp.revenue),
      i("assets", inp.totalAssets),
      i("equity", inp.shareholdersEquity),
    ], "%"));
    calcs.push(calc("Net margin", pm * 100, "net_income / revenue", [i("net income", inp.netIncome), i("revenue", inp.revenue)], "%"));
    calcs.push(calc("Asset turnover", at, "revenue / assets", [i("revenue", inp.revenue), i("assets", inp.totalAssets)], "x"));
    calcs.push(calc("Equity multiplier", em, "assets / equity", [i("assets", inp.totalAssets), i("equity", inp.shareholdersEquity)], "x"));
  } else warnings.push("DuPont ROE skipped: need net income, revenue, assets and equity");

  // ---- Altman Z-Score ------------------------------------------------------
  const wc = inp.currentAssets != null && inp.currentLiabilities != null ? inp.currentAssets - inp.currentLiabilities : undefined;
  const mve = marketCap;
  if (wc != null && inp.totalAssets && inp.retainedEarnings != null && inp.ebit != null && inp.totalLiabilities && mve) {
    const A = wc / inp.totalAssets;
    const B = inp.retainedEarnings / inp.totalAssets;
    const C = inp.ebit / inp.totalAssets;
    const D = mve / inp.totalLiabilities;
    const E = (inp.revenue ?? 0) / inp.totalAssets;
    const z = 1.2 * A + 1.4 * B + 3.3 * C + 0.6 * D + 1.0 * E;
    calcs.push(calc("Altman Z-Score", z, "1.2A + 1.4B + 3.3C + 0.6D + 1.0E", [
      i("working capital", wc),
      i("total assets", inp.totalAssets),
      i("retained earnings", inp.retainedEarnings),
      i("EBIT", inp.ebit),
      i("total liabilities", inp.totalLiabilities),
      i("market cap", mve),
    ], "z"));
  } else warnings.push("Altman Z-Score skipped: need working capital, retained earnings, EBIT, liabilities and market cap");

  // ---- Piotroski F-Score ----------------------------------------------------
  const fscore = computeFScore(inp, prior);
  if (fscore != null) {
    calcs.push(calc("Piotroski F-Score", fscore, "sum of 9 binary financial signals", [
      i("score points", fscore),
    ], "score"));
  } else warnings.push("Piotroski F-Score skipped: need current and prior-year statement data");

  return { calcs, warnings };
}

/**
 * 9-point F-Score. Requires current + prior-year figures; returns null if
 * the prior year is missing (a 0-9 score from a single year would be fake).
 */
function computeFScore(inp: FundamentalInputs, prior?: PriorFundamentalInputs): number | null {
  if (!prior) return null;
  let score = 0;
  const roa = (netIncome: number | undefined) => (netIncome != null && inp.totalAssets ? netIncome / inp.totalAssets : undefined);
  const curRoa = roa(inp.netIncome);
  const priRoa = prior.netIncome != null && prior.totalAssets ? prior.netIncome / prior.totalAssets : undefined;

  if (inp.netIncome != null && inp.netIncome > 0) score++;                                   // 1. ROA > 0
  if (inp.operatingCashFlow != null && inp.operatingCashFlow > 0) score++;                    // 2. CFO > 0
  if (curRoa != null && priRoa != null && curRoa > priRoa) score++;                           // 3. ΔROA > 0
  if (inp.netIncome != null && inp.operatingCashFlow != null && inp.operatingCashFlow > inp.netIncome) score++; // 4. CFO > NI
  const leverage = (liab: number | undefined, assets: number | undefined) =>
    liab != null && assets ? liab / assets : undefined;
  const curLev = leverage(inp.totalLiabilities, inp.totalAssets);
  const priLev = leverage(prior.totalLiabilities, prior.totalAssets);
  if (curLev != null && priLev != null && curLev < priLev) score++;                            // 5. ΔLeverage < 0
  const cr = (ca: number | undefined, cl: number | undefined) => (ca != null && cl ? ca / cl : undefined);
  const curCr = cr(inp.currentAssets, inp.currentLiabilities);
  const priCr = cr(prior.currentAssets, prior.currentLiabilities);
  if (curCr != null && priCr != null && curCr > priCr) score++;                                // 6. ΔCurrentRatio > 0
  if (inp.sharesOutstanding != null && prior.sharesOutstanding != null && inp.sharesOutstanding <= prior.sharesOutstanding) score++; // 7. No new shares
  const gm = (rev: number | undefined, cogs: number | undefined) =>
    rev && cogs != null ? (rev - cogs) / rev : undefined;
  const curGm = gm(inp.revenue, inp.cogs);
  const priGm = gm(prior.revenue, prior.cogs);
  if (curGm != null && priGm != null && curGm > priGm) score++;                                // 8. ΔGrossMargin > 0
  const ato = (rev: number | undefined, assets: number | undefined) => (rev != null && assets ? rev / assets : undefined);
  const curAto = ato(inp.revenue, inp.totalAssets);
  const priAto = ato(prior.revenue, prior.totalAssets);
  if (curAto != null && priAto != null && curAto > priAto) score++;                            // 9. ΔAssetTurnover > 0
  return score;
}

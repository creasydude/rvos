// Technical indicator calculations — thin wrapper over `technicalindicators`,
// plus hand-rolled stats that package doesn't expose. Pure, unit-testable.

import {
  SMA, EMA, MACD, RSI, BollingerBands, Stochastic, ATR, ADX, VWAP, OBV, SD,
} from "technicalindicators";
import { Calc, Input, TechnicalInputs, TechnicalResult, num } from "./types";

function i(name: string, value: number | string | undefined | null, source: Input["source"] = "technical"): Input | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return { name, value, source };
  if (!isFinite(value)) return null;
  return { name, value: String(num(value, 4) ?? value), source };
}

function calc(name: string, value: number, formula: string, inputs: (Input | null)[], unit?: Calc["unit"]): Calc {
  return { name, value, unit, formula, inputs: inputs.filter((x): x is Input => x !== null) };
}

const last = <T>(a: T[]): T | undefined => a[a.length - 1];

export function analyzeTechnical(inp: TechnicalInputs): TechnicalResult {
  const calcs: Calc[] = [];
  const warnings: string[] = [];
  const { close } = inp;
  // High/low fall back to close when absent OR empty (empty arrays otherwise
  // break ADX/ATR which demand equal sizes). Volume stays empty when absent —
  // the OBV/VWAP guards check its length against close so price is never used
  // as a volume proxy.
  const high = inp.high && inp.high.length ? inp.high : close;
  const low = inp.low && inp.low.length ? inp.low : close;
  const volume = inp.volume && inp.volume.length ? inp.volume : [];

  if (close.length < 2) {
    return { calcs, warnings: ["Need at least 2 price points for technical analysis"], lastPrice: close[0] };
  }
  const lastPrice = close[close.length - 1];

  // ---- Price vs moving averages -------------------------------------------
  for (const p of [20, 50, 200]) {
    if (close.length >= p) {
      const avg = SMA.calculate({ period: p, values: close });
      const lastAvg = last(avg)!;
      const above = lastPrice > lastAvg;
      calcs.push(calc(
        above ? "Price above SMA" + p : "Price below SMA" + p,
        (lastPrice - lastAvg) / lastAvg * 100,
        `(price - sma${p}) / sma${p} * 100`,
        [i("price", lastPrice), i(`SMA${p}`, lastAvg)],
      ));
    }
  }

  // ---- EMA + MACD ----------------------------------------------------------
  if (close.length >= 26) {
    const ema12 = last(EMA.calculate({ period: 12, values: close }))!;
    const ema26 = last(EMA.calculate({ period: 26, values: close }))!;
    const macd = MACD.calculate({ values: close, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
    const lastMacd = last(macd);
    if (lastMacd) {
      calcs.push(calc("MACD", lastMacd.MACD ?? NaN, "ema12 - ema26", [i("EMA12", ema12), i("EMA26", ema26)], "num"));
      calcs.push(calc("MACD signal", lastMacd.signal ?? NaN, "9-period EMA of MACD", [i("MACD", lastMacd.MACD ?? NaN)], "num"));
      calcs.push(calc("MACD histogram", lastMacd.histogram ?? NaN, "macd - signal", [i("MACD", lastMacd.MACD ?? NaN), i("signal", lastMacd.signal ?? NaN)], "num"));
    }
  }

  // ---- RSI -----------------------------------------------------------------
  if (close.length >= 14) {
    const rsi = RSI.calculate({ period: 14, values: close });
    const v = last(rsi);
    if (v != null) {
      calcs.push(calc("RSI(14)", v, "100 - 100/(1+RS)", [i("period", 14)], "score"));
      calcs.push(calc("RSI condition", v >= 70 ? 1 : v <= 30 ? -1 : 0, "70+ overbought, 30- oversold", [i("RSI", v)], "num"));
    }
  }

  // ---- Bollinger Bands -----------------------------------------------------
  if (close.length >= 20) {
    const bb = BollingerBands.calculate({ period: 20, stdDev: 2, values: close });
    const b = last(bb);
    if (b) {
      calcs.push(calc("BB upper", b.upper, "sma20 + 2*std", [i("sma20", b.middle)], "num"));
      calcs.push(calc("BB lower", b.lower, "sma20 - 2*std", [i("sma20", b.middle)], "num"));
      calcs.push(calc("%B", b.pb, "(price - lower) / (upper - lower)", [i("upper", b.upper), i("lower", b.lower)], "%"));
    }
  }

  // ---- Stochastic oscillator ------------------------------------------------
  if (close.length >= 14) {
    const st = Stochastic.calculate({ period: 14, signalPeriod: 3, high, low, close });
    const s = last(st);
    if (s) {
      calcs.push(calc("Stoch %K", s.k, "%K = (close - low14)/(high14 - low14)*100", [i("period", 14)], "%"));
      calcs.push(calc("Stoch %D", s.d, "3-period SMA of %K", [i("%K", s.k)], "%"));
    }
  }

  // ---- ATR -----------------------------------------------------------------
  if (close.length >= 14 && high.length === close.length && low.length === close.length) {
    const atr = ATR.calculate({ period: 14, high, low, close });
    const v = last(atr);
    if (v != null) calcs.push(calc("ATR(14)", v, "Average of True Range (14)", [i("period", 14)], "num"));
  }

  // ---- ADX --------------------------------------------------------------
  if (close.length >= 28) {
    const adx = ADX.calculate({ period: 14, high, low, close });
    const a = last(adx);
    if (a) {
      calcs.push(calc("ADX(14)", a.adx, "smoothed DX", [i("period", 14)], "score"));
      calcs.push(calc("ADX +DI", a.pdi, "+DM/TR smoothed", [], "%"));
      calcs.push(calc("ADX -DI", a.mdi, "-DM/TR smoothed", [], "%"));
    }
  }

  // ---- OBV -----------------------------------------------------------------
  if (volume.length === close.length && close.length >= 2) {
    const obv = OBV.calculate({ close, volume });
    const v = last(obv);
    if (v != null) calcs.push(calc("OBV", v, "cumulative volume on up/down close", [i("volume series", volume.length)], "num"));
  }

  // ---- VWAP ----------------------------------------------------------------
  if (volume.length === close.length) {
    const vwap = VWAP.calculate({ high, low, close, volume });
    const v = last(vwap);
    if (v != null) {
      calcs.push(calc("VWAP", v, "Σ(typical*vol) / Σvol", [i("price points", close.length)], "num"));
      calcs.push(calc("Price vs VWAP", (lastPrice - v) / v * 100, "(price - vwap) / vwap * 100", [i("price", lastPrice), i("VWAP", v)], "%"));
    }
  }

  // ---- Price Z-score vs moving average -------------------------------------
  if (close.length >= 20) {
    const mean = SMA.calculate({ period: 20, values: close });
    const sdArr = SD.calculate({ period: 20, values: close });
    const m = last(mean), s = last(sdArr);
    if (m != null && s != null && s > 0) {
      calcs.push(calc("Price Z-score(20)", (lastPrice - m) / s, "(price - sma20) / std20", [i("price", lastPrice), i("sma20", m), i("std20", s)], "z"));
    }
  }

  // ---- Linear regression trend channel + support/resistance ----------------
  const trend = linearRegression(close);
  if (trend) {
    const { slope, intercept, lastTrend, r2 } = trend;
    calcs.push(calc("Trend slope (per bar)", slope, "OLS slope of close", [i("bars", close.length)], "num"));
    calcs.push(calc("Trend R²", r2, "coefficient of determination", [], "ratio"));
    const band = stdDev(close) * 0.5;
    calcs.push(calc("Trend upper channel", lastTrend + band, "trend + 0.5*std", [i("trend value", lastTrend), i("std", band)], "num"));
    calcs.push(calc("Trend lower channel", lastTrend - band, "trend - 0.5*std", [i("trend value", lastTrend), i("std", band)], "num"));
  }

  const supportResistance = findSupportResistance(close);
  if (supportResistance) {
    const { support, resistance } = supportResistance;
    calcs.push(calc("Support level", support, "recent pivot low", [i("bars", close.length)], "num"));
    calcs.push(calc("Resistance level", resistance, "recent pivot high", [i("bars", close.length)], "num"));
  }

  return { calcs, warnings, lastPrice };
}

/** OLS linear regression over an index → { slope, intercept, lastTrend, r2 }. */
function linearRegression(values: number[]) {
  const n = values.length;
  if (n < 2) return null;
  const xs = Array.from({ length: n }, (_, i) => i);
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((a, b) => a + b, 0) / n;
  let ssxy = 0, ssxx = 0, ssyy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - xMean, dy = values[i] - yMean;
    ssxy += dx * dy;
    ssxx += dx * dx;
    ssyy += dy * dy;
  }
  if (ssxx === 0) return null;
  const slope = ssxy / ssxx;
  const intercept = yMean - slope * xMean;
  const r2 = ssyy === 0 ? 0 : (ssxy * ssxy) / (ssxx * ssyy);
  return { slope, intercept, lastTrend: intercept + slope * (n - 1), r2 };
}

function stdDev(values: number[]): number {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
}

/**
 * Simple support/resistance: scan recent local minima/maxima over a window
 * and return the nearest one below and above the last price.
 * ponytail: naive pivot heuristic; fine for a research aid, not order-level precision.
 */
function findSupportResistance(close: number[], window = 5) {
  const n = close.length;
  if (n < window * 2 + 1) return null;
  const pivots: number[] = [];
  for (let i = window; i < n - window; i++) {
    const slice = close.slice(i - window, i + window + 1);
    const max = Math.max(...slice), min = Math.min(...slice);
    if (close[i] === max || close[i] === min) pivots.push(close[i]);
  }
  if (!pivots.length) return null;
  const lastPrice = close[n - 1];
  const support = Math.max(...pivots.filter((p) => p < lastPrice));
  const resistance = Math.min(...pivots.filter((p) => p > lastPrice));
  if (!isFinite(support) && !isFinite(resistance)) return null;
  return {
    support: isFinite(support) ? support : lastPrice,
    resistance: isFinite(resistance) ? resistance : lastPrice,
  };
}

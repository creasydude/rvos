// TSETMC CDN JSON API client. Read-only fetchers for the technical + flow
// data RVOS's brain consumes. No auth, no rate limit observed from Iranian
// egress; we still throttle politely and cache nothing here (storage is in SQLite).
//
// Endpoint map verified live 2026-08-07 (see rvos-data-feasibility-report.md).

const BASE = "https://cdn.tsetmc.com";
const UA = "rvos-market-bot/0.1 (+research)";

export type TseInstrument = {
  insCode?: string;
  insCode2?: string;
  insCode3?: string;
  insCode4?: string;
  lVal18AFC?: string;
  lVal30?: string;
  lVal18?: string;
  lVal15?: string;
  cIsin?: string | null;
  flow?: number;
  flowTitle?: string;
  baseVol?: number;
  zTitad?: number;
  cgrValCot?: string;
  cgrValCotTitle?: string;
};

type TseEps = {
  epsValue?: number | null;
  estimatedEPS?: number | string | null;
  sectorPE?: number;    // sector average P/E (Hybrid peer auto-fill)
  sectorRate?: number;
  psr?: number;
};

export type TseQuote = {
  insCode?: string;
  lVal18AFC?: string;
  lVal18?: string;
  lVal30?: string;
  cIsin?: string;
  last?: number;   // last traded price (some responses expose this directly)
  flow?: number;
  flowTitle?: string;
  zTitad?: number;
  baseVol?: number;
  yVal?: string;            // opening price (string)
  pDrCotVal?: number;       // last traded / closing price
  priceChange?: number;
  priceMin?: number;
  priceMax?: number;
  dEven?: number;
  hEven?: number;
  qTotTran5J?: number;      // volume
  qTotCap?: number;         // value
  eps?: TseEps;
  sector?: { cSecVal?: string; lSecVal?: string } | null;
};

export type TseBar = {
  priceChange?: number;
  priceMin?: number;
  priceMax?: number;
  priceYesterday?: number;
  priceFirst?: number;
  last?: boolean;
  pClosing?: number;        // official close (adjusted for capital acts)
  pDrCotVal?: number;       // last traded price
  zTotTran?: number;        // traded share count
  qTotTran5J?: number;      // number of trades
  qTotCap?: number;         // traded value
  dEven?: number;           // YYYYMMDD
  hEven?: number;
};

export type TseAdjust = { insCode?: string; dEven?: number; pClosing?: number; pClosingNotAdjusted?: number };

export type TseShare = { insCode?: string; dEven?: number; numberOfShareNew?: number; numberOfShareOld?: number };

export type TseClientFlow = {
  recDate?: number;
  buy_I_Volume?: number;
  buy_N_Volume?: number;
  buy_I_Value?: number;
  buy_N_Value?: number;
  buy_N_Count?: number;
  buy_I_Count?: number;
  sell_I_Volume?: number;
  sell_N_Volume?: number;
  sell_I_Value?: number;
  sell_N_Value?: number;
  sell_N_Count?: number;
  sell_I_Count?: number;
};

async function get<T>(path: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20000);
    try {
      const res = await fetch(`${BASE}${path}`, {
        signal: ctl.signal,
        headers: { "User-Agent": UA, Accept: "application/json" },
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
      const text = await res.text();
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("html")) throw new Error(`SPA fallback (not an API route): ${path}`);
      return JSON.parse(text) as T;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      const wait = 400 * 2 ** attempt;
      if (attempt < 2) await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export function searchInstrument(q: string): Promise<TseInstrument[]> {
  return get<{ instrumentSearch?: TseInstrument[] }>(
    `/api/Instrument/GetInstrumentSearch/${encodeURIComponent(q)}`,
  ).then((d) => d.instrumentSearch ?? []);
}

export function getInstrumentInfo(insCode: string): Promise<TseQuote | null> {
  return get<{ instrumentInfo?: TseQuote }>(`/api/Instrument/GetInstrumentInfo/${insCode}`).then(
    (d) => d.instrumentInfo ?? null,
  );
}

export function getClosingPriceDailyList(insCode: string, count = 6000): Promise<TseBar[]> {
  return get<{ closingPriceDaily?: TseBar[] }>(
    `/api/ClosingPrice/GetClosingPriceDailyList/${insCode}/${count}`,
  ).then((d) => d.closingPriceDaily ?? []);
}

export function getPriceAdjustList(insCode: string): Promise<TseAdjust[]> {
  return get<{ priceAdjust?: TseAdjust[] }>(`/api/ClosingPrice/GetPriceAdjustList/${insCode}`).then(
    (d) => d.priceAdjust ?? [],
  );
}

export function getShareChange(insCode: string): Promise<TseShare[]> {
  return get<{ instrumentShareChange?: TseShare[] }>(
    `/api/Instrument/GetInstrumentShareChange/${insCode}`,
  ).then((d) => d.instrumentShareChange ?? []);
}

export function getClientTypeHistory(insCode: string): Promise<TseClientFlow[]> {
  return get<{ clientType?: TseClientFlow[] }>(`/api/ClientType/GetClientTypeHistory/${insCode}`).then(
    (d) => d.clientType ?? [],
  );
}
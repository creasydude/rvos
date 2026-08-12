// "AI write-up" orchestration for a synced market symbol.
//
// Reads the stored technicals + fundamentals, runs the brain (via streamAnalysis),
// and hands the synthesis LLM the enriched fundamental notes — the computed ratios
// PLUS the deterministic statement/report context (lib/market/context.ts) and an
// explicit `unitSystem: "rial"` so it reasons in the listing currency. The streamed
// write-up is persisted by the API route and becomes the source of truth for
// follow-up chat, which receives the same enriched JSON verbatim.

import { streamAnalysis, type AnalysisContext } from "@/lib/analyze";
import { loadTechnicalInputs, loadFundamentalInputs, latestClose } from "./load";
import { loadFundamentalContext, renderNarrative } from "./context";
import { resolveInsCode } from "./sync";

const MAX_TECHNICAL_BARS = 120; // cap the LLM's price series (~half a year of daily bars)

export type MarketWriteupResult = {
  stream: ReadableStream<string>;
  context: AnalysisContext;
};

export async function streamMarketAnalysis(symbolOrCode: string): Promise<MarketWriteupResult> {
  const insCode = await resolveInsCode(symbolOrCode);
  if (!insCode) throw new Error(`instrument not found: ${symbolOrCode}`);

  const tech = loadTechnicalInputs(insCode);
  const { inputs, prior, fy } = loadFundamentalInputs(insCode);
  const ctx = await loadFundamentalContext(insCode);

  // Readable, labeled markdown of the line items + statement + disclosure reports
  // — the section the synthesis prompt directs the LLM to mine. Stored alongside
  // (inside) the fundamental JSON so follow-up chat sees it too.
  const narrative = renderNarrative(ctx);

  const symbol = ctx.symbol ?? symbolOrCode;
  const last = latestClose(insCode) ?? inputs.price;

  // Technical notes — the recent price series, capped so the LLM context stays
  // bounded (the brain still gets the full series; only the notes are trimmed).
  const sliceLast = <T>(arr: T[]): T[] => (arr.length > MAX_TECHNICAL_BARS ? arr.slice(-MAX_TECHNICAL_BARS) : arr);
  const technical: Record<string, unknown> = { ticker: symbol };
  if (tech.close.length) technical.close = sliceLast(tech.close);
  if (tech.high?.length) technical.high = sliceLast(tech.high);
  if (tech.low?.length) technical.low = sliceLast(tech.low);
  if (tech.open?.length) technical.open = sliceLast(tech.open);
  if (tech.volume?.length) technical.volume = sliceLast(tech.volume);
  if (last != null && last > 0) technical.notes = [`last close = ${last} rials`];

  // Fundamental notes — the brain's numeric inputs (camelCase, matches the brain
  // key set) plus the qualitative context and an explicit unit system.
  const fundamental: Record<string, unknown> = {
    ticker: symbol,
    unitSystem: "rial",
    ...inputs,
  };
  if (prior && Object.keys(prior).length) fundamental.priorYear = prior;
  fundamental.statementContext = ctx;
  // Readable markdown narrative, embedded so it persists with the analysis (chat
  // re-reads it from the JSON); also passed separately to streamAnalysis so the
  // synthesis prompt can present it as a labeled section, not a JSON field.
  fundamental.narrative = narrative;
  fundamental.notes = [
    "All monetary figures are in Iranian rial (ریال); per-share values are rials per share.",
    ...(fy != null ? [`Fiscal year on file: ${ctx.periodEnd ?? String(fy)}`] : []),
  ];

  const { stream, context } = await streamAnalysis(
    {
      fundamental: JSON.stringify(fundamental),
      technical: JSON.stringify(technical),
      narrative,
    },
    { units: "rial" },
  );
  return { stream, context };
}
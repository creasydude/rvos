// "AI thesis" orchestration for scenario analysis on a synced market symbol.
//
// Loads the same data as the regular write-up (technical + fundamental +
// statement context), runs the deterministic scenario engine, and attaches
// the full ScenarioOutput to the fundamental JSON so the synthesis LLM
// receives both the standard brain calcs AND the scenario projections.
// buildSynthesisPrompt / buildChatSystem already handle the `scenarios` key.

import { streamAnalysis, type AnalysisContext } from "@/lib/analyze";
import { loadTechnicalInputs, loadFundamentalInputs, latestClose } from "./load";
import { loadFundamentalContext, renderNarrative } from "./context";
import { resolveInsCode } from "./sync";
import { runScenariosFromInputs } from "@/brain/scenarios";

const MAX_TECHNICAL_BARS = 120;

export type ScenarioWriteupResult = {
  stream: ReadableStream<string>;
  context: AnalysisContext;
};

export async function streamScenarioAnalysis(symbolOrCode: string): Promise<ScenarioWriteupResult> {
  const insCode = await resolveInsCode(symbolOrCode);
  if (!insCode) throw new Error(`instrument not found: ${symbolOrCode}`);

  const tech = loadTechnicalInputs(insCode);
  const { inputs, prior, fy } = loadFundamentalInputs(insCode);
  const ctx = await loadFundamentalContext(insCode);
  const narrative = renderNarrative(ctx);

  const symbol = ctx.symbol ?? symbolOrCode;
  const last = latestClose(insCode) ?? inputs.price;

  // --- Scenario engine ---
  const scenarioOutput = runScenariosFromInputs(inputs, {
    symbol,
    name: ctx.name ?? undefined,
    fy,
    unitSystem: "rial",
  });

  // --- Technical notes (capped) ---
  const sliceLast = <T>(arr: T[]): T[] => (arr.length > MAX_TECHNICAL_BARS ? arr.slice(-MAX_TECHNICAL_BARS) : arr);
  const technical: Record<string, unknown> = { ticker: symbol };
  if (tech.close.length) technical.close = sliceLast(tech.close);
  if (tech.high?.length) technical.high = sliceLast(tech.high);
  if (tech.low?.length) technical.low = sliceLast(tech.low);
  if (tech.open?.length) technical.open = sliceLast(tech.open);
  if (tech.volume?.length) technical.volume = sliceLast(tech.volume);
  if (last != null && last > 0) technical.notes = [`last close = ${last} rials`];

  // --- Fundamental notes (enriched with scenario output) ---
  const fundamental: Record<string, unknown> = {
    ticker: symbol,
    unitSystem: "rial",
    ...inputs,
  };
  if (prior && Object.keys(prior).length) fundamental.priorYear = prior;
  fundamental.statementContext = ctx;
  fundamental.narrative = narrative;
  // THE KEY DIFFERENCE from writeup.ts: attach the full scenario output so
  // the synthesis prompt can read it and the LLM can weave a thesis.
  fundamental.scenarios = JSON.stringify(scenarioOutput);
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

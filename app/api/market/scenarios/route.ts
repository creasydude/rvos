import { NextRequest } from "next/server";
import { resolveInsCode } from "@/lib/market/sync";
import { loadFundamentalInputs } from "@/lib/market/load";
import { runScenariosFromInputs } from "@/brain/scenarios";
import type { ScenarioInput } from "@/brain/scenario-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/market/scenarios?symbol=فولاد   (symbol or 20-digit insCode)
 *
 * Runs the deterministic scenario engine on synced fundamental data.
 * Returns 4 preset macro scenarios (persistent-sanctions, partial-normalization,
 * full-normalization, severe-deterioration) with projected financials, DCF
 * valuations, sensitivity tables, and operating bridges.
 *
 * Optional query params:
 *   ?probabilities=p1,p2,p3,p4  — comma-separated probability weights (must sum to ~1.0)
 *   ?custom=true                — include a custom scenario slot (returns preset only)
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const sym = q.get("symbol") ?? q.get("insCode");
  if (!sym) return Response.json({ ok: false, error: "missing ?symbol= or ?insCode=" }, { status: 400 });

  try {
    const insCode = await resolveInsCode(sym);
    if (!insCode) return Response.json({ ok: false, error: `instrument not found: ${sym}` }, { status: 404 });

    const f = loadFundamentalInputs(insCode);
    if (!f.inputs.revenue && !f.inputs.ebitda) {
      return Response.json(
        { ok: false, error: `no fundamental data stored — sync ${sym} first` },
        { status: 409 },
      );
    }

    // Optional probability weights
    const probParam = q.get("probabilities");
    let customScenarios: import("@/brain/scenario-types").ScenarioConfig[] | undefined;
    if (probParam) {
      const probs = probParam.split(",").map((s) => parseFloat(s.trim()));
      if (probs.length === 4 && probs.every((p) => isFinite(p) && p >= 0 && p <= 1)) {
        // Probability weights are passed as scenario configs with probability set
        // The engine uses these when provided
        const ids = ["persistent-sanctions", "partial-normalization", "full-normalization", "severe-deterioration"] as const;
        customScenarios = ids.map((id, i) => ({
          id,
          name: id,
          description: "",
          macro: {},
          probability: probs[i],
        }));
      }
    }

    const output = runScenariosFromInputs(f.inputs, {
      symbol: f.inputs.price != null ? sym : undefined,
      name: undefined,
      fy: f.fy,
      unitSystem: "rial",
      customScenarios,
    });

    return Response.json({
      ok: true,
      insCode,
      symbol: sym,
      fiscalYear: f.fy,
      output,
    });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}

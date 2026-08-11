import { NextRequest } from "next/server";
import { resolveInsCode } from "@/lib/market/sync";
import { loadTechnicalInputs, loadFundamentalInputs, latestClose } from "@/lib/market/load";
import { loadFundamentalContext } from "@/lib/market/context";
import { analyzeTechnical } from "@/brain/technical";
import { analyzeFundamental } from "@/brain/fundamental";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/market/analyze?symbol=فولاد   (symbol or 20-digit insCode)
 *
 * Loads the synced market data for an instrument and runs the brain on it —
 * the same code path the chat pipeline uses, but for a stored symbol.
 * Fundamental analysis only produces calcs if a statement PDF has been parsed
 * into the `fundamentals` table; technicals are available after any EOD sync.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const sym = q.get("symbol") ?? q.get("insCode");
  if (!sym) return Response.json({ ok: false, error: "missing ?symbol= or ?insCode=" }, { status: 400 });

  try {
    const insCode = await resolveInsCode(sym);
    if (!insCode) return Response.json({ ok: false, error: `instrument not found: ${sym}` }, { status: 404 });

    const tInputs = loadTechnicalInputs(insCode);
    if (!tInputs.close.length)
      return Response.json({ ok: false, error: `no bars stored — sync ${sym} first` }, { status: 409 });

    const tRes = analyzeTechnical(tInputs);
    const f = loadFundamentalInputs(insCode);
    const fRes = analyzeFundamental(f.inputs, f.prior);
    // The deterministic statement/report context the AI write-up hands the LLM —
    // surfaced here so the UI can show exactly what the synthesis model sees.
    const fctx = await loadFundamentalContext(insCode);

    return Response.json({
      ok: true,
      insCode,
      symbol: sym,
      lastPrice: latestClose(insCode),
      bars: tInputs.close.length,
      fiscalYear: f.fy,
      technical: {
        calcs: tRes.calcs.map((c) => ({ name: c.name, value: c.value, unit: c.unit ?? "num", inputs: c.inputs })),
        warnings: tRes.warnings,
      },
      fundamental: {
        populated: Object.keys(f.inputs).filter((k) => f.inputs[k as keyof typeof f.inputs] !== undefined),
        calcs: fRes.calcs.map((c) => ({ name: c.name, value: c.value, unit: c.unit ?? "num", inputs: c.inputs })),
        warnings: fRes.warnings,
        context: fctx,
      },
    });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
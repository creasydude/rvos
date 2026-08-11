import { NextRequest } from "next/server";
import {
  syncEod,
  syncSymbol,
  syncCodalRecent,
  parseRecordedStatements,
  listInstruments,
} from "@/lib/market/sync";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COUNT_TABLES = [
  "instruments",
  "daily_bars",
  "price_adjustments",
  "share_changes",
  "client_flows",
  "quotes_snapshot",
  "codal_letters",
  "statement_docs",
  "fundamentals",
  "codal_reports",
];

/** GET /api/market — status: known instruments + row counts. */
export async function GET() {
  const instruments = listInstruments();
  const counts: Record<string, number> = {};
  for (const t of COUNT_TABLES) {
    try {
      const r = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number };
      counts[t] = Number(r.n ?? 0);
    } catch {
      counts[t] = -1;
    }
  }
  return Response.json({ instruments, counts });
}

/**
 * POST /api/market
 *   { action: "sync" }                  → EOD sync for every known instrument
 *   { action: "sync", symbol: "فولاد" } → sync one symbol/code
 *   { action: "syncCodal", days?, limit?, download? } → pull recent Codal filings
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const action = typeof body.action === "string" ? body.action : "sync";

  try {
    if (action === "syncCodal") {
      const r = await syncCodalRecent({
        days: typeof body.days === "number" ? body.days : 30,
        limit: typeof body.limit === "number" ? body.limit : 40,
        download: body.download !== false,
      });
      // Tracked statement PDFs/Excel are then parsed into `fundamentals` line
      // items so the Analyze step sees real numbers (until now parsing only
      // ever ran in scripts).
      const parsed = await parseRecordedStatements();
      return Response.json({ ok: true, ...r, parsed });
    }

    if (typeof body.symbol === "string" && body.symbol.trim()) {
      const r = await syncSymbol(body.symbol.trim());
      return Response.json(r);
    }

    const results = await syncEod();
    const ok = results.filter((r) => r.ok).length;
    return Response.json({ ok: true, total: results.length, succeeded: ok, results });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
// End-to-end smoke test for the Option A market ETL (Task #13).
// Runs REAL network calls to TSETMC from the sandbox, writes to SQLite, loads
// the brain inputs back, and runs the technical + fundamental brain on them.
//
//   npx tsx scripts/market-sync-test.ts [symbol] [insCode]
//
// Usage: symbol/insCode optional; defaults to "فولاد".

import { db } from "../lib/db";
import { ensureMarketSchema } from "../lib/market/schema";
import { syncSymbol, syncCodalRecent, listInstruments } from "../lib/market/sync";
import { loadTechnicalInputs, loadFundamentalInputs } from "../lib/market/load";
import { parseAndLoadStatements } from "../lib/market/parse";
import { analyzeTechnical } from "../brain/technical";
import { analyzeFundamental } from "../brain/fundamental";

ensureMarketSchema();

async function main() {
  const target = process.argv[2] ?? "فولاد";
  console.log(`\n== E2E market sync test — target "${target}" ==\n`);

  // 1) Sync the instrument.
  console.log("[1] syncSymbol…");
  const res = await syncSymbol(target);
  console.log("    result:", JSON.stringify(res));
  if (!res.ok) {
    console.error("\n!! sync failed — skipping brain run:", res.reason);
  } else {
    const insCode = res.insCode!;
    console.log(`    insCode = ${insCode}, symbol = ${res.symbol}\n`);

    // 2) Technical inputs → brain.
    console.log("[2] loadTechnicalInputs + analyzeTechnical …");
    const tInputs = loadTechnicalInputs(res.insCode!);
    console.log(`    bars loaded: close=${tInputs.close.length}, high=${tInputs.high?.length ?? 0}, volume=${tInputs.volume?.length ?? 0}`);
    console.log(`    first close=${tInputs.close[0]}, last close=${tInputs.close[tInputs.close.length - 1]}`);
    const tRes = analyzeTechnical(tInputs);
    const tCalcs = tRes.calcs.map((c) => `${c.name}=${c.value.toFixed(2)}`).join(", ");
    console.log("    technical calcs:", tCalcs.slice(0, 300));
    console.log("    technical warnings:", tRes.warnings.join("; ") || "none");

    // 3) Fundamental loader (likely empty without a parsed PDF, but exercises the seam).
    console.log("\n[3] loadFundamentalInputs …");
    const f = loadFundamentalInputs(insCode);
    console.log(`    fy=${f.fy}, price=${f.inputs.price}, shares=${f.inputs.sharesOutstanding}, marketCap=${f.inputs.marketCap}, pePeer=${f.inputs.pePeer}`);
    const keys = Object.keys(f.inputs) as (keyof typeof f.inputs)[];
    console.log("    input keys populated:", keys.filter((k) => f.inputs[k] !== undefined).join(", ") || "(none)");
    if (f.inputs.netIncome != null) {
      const fRes = analyzeFundamental(f.inputs, f.prior, "rial");
      console.log("    fundamental calcs:", fRes.calcs.map((c) => `${c.name}=${c.value.toFixed(2)}`).join(", ").slice(0, 300));
    }
  }

  // 4) Codal: pull a small recent batch (metadata only; skip PDFs to stay light+focused).
  console.log("\n[4] syncCodalRecent (metadata only) …");
  try {
    const c = await syncCodalRecent({ days: 7, limit: 15, download: false });
    console.log("    stored:", c.stored, "letter(s). Downloaded PDFs:", c.downloaded);
    const letters = db.prepare("SELECT COUNT(*) AS n FROM codal_letters").get() as { n: number };
    const docs = db.prepare("SELECT COUNT(*) AS n FROM statement_docs").get() as { n: number };
    console.log(`    codal_letters rows = ${letters.n}, statement_docs rows = ${docs.n}`);
  } catch (e) {
    console.error("    codal sync failed:", (e as Error).message);
  }

  console.log("\n[5] parse recorded statements (0 if none tracked):");
  if (res.ok) {
    const p = await parseAndLoadStatements(res.insCode!);
    console.log("    parse result:", JSON.stringify(p));
  }

  const known = listInstruments().map((i) => `${i.symbol}/${i.insCode}`).join(", ");
  console.log("\n[know] instruments now stored:", known || "(none)");
  console.log("\n== done ==");
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
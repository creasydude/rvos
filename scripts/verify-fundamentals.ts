// Verify the per-symbol Codal statement sync + parse fix end-to-end against a
// scratch DB (set RVOS_DATA_DIR=/tmp/dbcopy). Checks that syncing a symbol now
// pulls its periodic financial statements, parses them into `fundamentals`, and
// that the fundamental brain round-trips non-empty inputs for the symbol.
//
//   RVOS_DATA_DIR=/tmp/dbcopy npx tsx scripts/verify-fundamentals.ts [symbol]

import { ensureMarketSchema } from "../lib/market/schema";
import { syncCodalForSymbol, parseRecordedStatements } from "../lib/market/sync";
import { loadFundamentalInputs } from "../lib/market/load";
import { analyzeFundamental } from "../brain/fundamental";
import { db } from "../lib/db";

ensureMarketSchema();

async function main() {
  const symbol = process.argv[2] ?? "غالبر";
  console.log(`\n== verify per-symbol fundamentals sync for "${symbol}" ==\n`);

  const count = (t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  console.log("fundamentals rows (before):", count("fundamentals"));
  console.log("statement_docs rows (before):", count("statement_docs"));

  console.log("\n[1] syncCodalForSymbol…");
  const r = await syncCodalForSymbol(symbol, { years: 2, maxPages: 12 });
  console.log("   result:", JSON.stringify(r));

  console.log("\n[2] statement_docs rows:", count("statement_docs"));
  console.log("   fundamentals rows:", count("fundamentals"));

  console.log("\n[3] fundamental analysis round-trip…");
  if (r.insCode) {
    const f = loadFundamentalInputs(r.insCode);
    const populated = Object.keys(f.inputs).filter((k) => f.inputs[k as keyof typeof f.inputs] !== undefined);
    console.log("   fy =", f.fy);
    console.log("   populated inputs:", populated.join(", ") || "(none)");
    const fRes = analyzeFundamental(f.inputs, f.prior, "rial");
    console.log("   fundamental calcs:", fRes.calcs.map((c) => `${c.name}=${c.value}`).join(", ") || "(none)");
    console.log("   fundamental warnings:", fRes.warnings.join("; ") || "(none)");
  }

  console.log("\n[4] parseRecordedStatements (batch path)…");
  const p = await parseRecordedStatements();
  console.log("   ", JSON.stringify(p));
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});

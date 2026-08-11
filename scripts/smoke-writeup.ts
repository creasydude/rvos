// Smoke test for the "important statements + AI write-up" feature.
//
//   npx tsx scripts/smoke-writeup.ts [symbol-or-insCode]
//
// 1. Backfills statement_docs.raw_text from the stored PDFs (exercises
//    extractPdfText + the raw_text persistence).
// 2. Loads loadFundamentalContext() for every synced instrument and prints a
//    compact summary of the context bundle the AI write-up would hand the LLM.
// 3. If a symbol/insCode argument is given, runs syncImportantStatements() for it
//    (network: Codal search + PDF downloads, best-effort) and reports the counts.

import { parseRecordedStatements, syncImportantStatements, listInstruments } from "../lib/market/sync";
import { loadFundamentalContext } from "../lib/market/context";

async function main() {
  console.log("== 1. backfill statement raw_text ==");
  const p = await parseRecordedStatements();
  console.log(`   parsed ${p.instruments} instruments -> ${p.items} line items (${p.errors} errors)`);

  console.log("\n== 2. fundamental context per instrument ==");
  for (const inst of listInstruments()) {
    const c = await loadFundamentalContext(inst.insCode);
    console.log(
      `   ${c.symbol ?? inst.insCode}: fy=${c.fy ?? "-"} period=${c.periodEnd ?? "-"} ` +
        `lineItems=${c.lineItems.length} statement=${c.statement ? `"${c.statement.title}" ${c.statement.excerpt.length}ch` : "none"} ` +
        `reports=${c.reports.length} units=${c.units}`,
    );
    for (const li of c.lineItems.slice(0, 3)) console.log(`      - ${li.label} (FY ${li.fy}) = ${li.value} rial`);
    for (const r of c.reports) console.log(`      report: [${r.kind}] ${r.title} ${r.published ?? ""} (${r.excerpt.length}ch)`);
  }

  const target = process.argv[2];
  if (target) {
    console.log(`\n== 3. sync important statements for ${target} ==`);
    const r = await syncImportantStatements(target);
    console.log(`   ok=${r.ok} stored=${r.reports} total=${r.total}${r.reason ? ` reason=${r.reason}` : ""}`);
  } else {
    console.log("\n== 3. skipped (pass a symbol/insCode to run the network important-statement sync) ==");
  }
}

main().catch((e) => {
  console.error("SMOKE FAILED:", e);
  process.exit(1);
});

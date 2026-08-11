import { searchLetters, pdfUrl } from "../lib/market/codal";
import { periodEndFromTitle } from "../lib/market/jalaali";
async function main() {
  // Try to find فولاد's periodic financial statements: search all recent types
  for (const lt of [-1, 12, 13, 6]) {
    try {
      const r = await searchLetters({ letterType: lt, fromDate: "1404/10/01", toDate: "1405/05/18", search: "فولاد", period: 12, page: 1 });
      console.log(`\n== letterType ${lt}: total=${r.total} ==`);
      for (const l of r.letters.slice(0, 12)) {
        const pe = periodEndFromTitle(l.Title ?? "");
        console.log(`  [${l.LetterCode ?? "-"}] ${(l.Title ?? "").slice(0, 80)} | pdf=${l.HasPdf ? "Y" : "n"} | pe=${pe} | TracingNo=${l.TracingNo}`);
      }
    } catch (e) {
      console.log(`letterType ${lt} errored:`, (e as Error).message);
    }
  }
}
main().catch((e) => { console.error("FATAL:", e); process.exit(1); });

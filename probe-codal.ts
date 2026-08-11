import { searchLetters, CODAL_PAGE_SIZE } from "./lib/market/codal";
import { periodEndFromTitle } from "./lib/market/jalaali";

const SYM = "غالبر";
async function main() {
  let foundAny = 0;
  for (let page = 1; page <= 40; page++) {
    const r = await searchLetters({ letterType: 6, period: 12, fromDate: "1404/12/19", toDate: "1405/05/18", page });
    const hits = r.letters.filter((l) => l.Symbol === SYM && /صورت|مالی|گزارش/i.test(l.Title ?? ""));
    for (const h of hits) {
      foundAny++;
      console.log(`page ${page} | hx=${h.TracingNo} | ${h.Title} | pdf=${!!h.HasPdf} excel=${!!h.HasExcel}`);
    }
    if (page === 1) console.log(`window total=${r.total} pages=${Math.ceil(r.total / CODAL_PAGE_SIZE)}`);
    if (r.letters.length < CODAL_PAGE_SIZE) break;
  }
  console.log(`done. foundAny=${foundAny}`);
}
main().catch((e) => { console.error(e); process.exit(1); });

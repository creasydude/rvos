// Scratch E2E: download a REAL company annual statement (letterType 6, 12-month
// period) for an industrial symbol, run parsePdf, print extracted line items.
// Usage: npx tsx scripts/parse-e2e.ts [symbol]
import fs from "fs";
import path from "path";
import { searchLetters, pdfUrl, downloadPdf, CODAL_PAGE_SIZE } from "../lib/market/codal";
import { parsePdf } from "../lib/market/parse";
import { METRICS } from "../lib/market/metrics";

const symbol = (process.argv[2] ?? "فولاد").replace(/"/g, "");

async function findAnnual(): Promise<{ url: string; title: string; symbol: string } | null> {
  for (let page = 1; page <= 30; page++) {
    const r = await searchLetters({
      letterType: 6,
      fromDate: "1404/06/01",
      toDate: "1405/05/18",
      period: 12,
      page,
    });
    const hits = r.letters.filter((l) => l.Symbol === symbol);
    console.log(`page ${page}: ${r.letters.length} letters (total ${r.total}) -> ${hits.length} for ${symbol}`);
    if (hits.length) {
      for (const h of hits) console.log("  hit:", h.TracingNo, h.Symbol, h.Title?.slice(0, 90), "pdf:", !!h.PdfUrl, "excel:", !!h.ExcelUrl);
      const good = hits.find((h) => h.PdfUrl) ?? hits[0];
      const url = pdfUrl(good);
      if (!url) continue;
      return { url, title: good.Title ?? "", symbol: good.Symbol ?? symbol };
    }
    if (r.letters.length < CODAL_PAGE_SIZE) break;
  }
  return null;
}

async function main() {
  const best = await findAnnual();
  if (!best) {
    console.log(`no ${symbol} annual statement found in range`);
    return;
  }
  console.log("downloading", best.url);
  const buf = Buffer.from(await downloadPdf(best.url));
  const out = path.join(process.env.RVOS_DATA_DIR ?? "/tmp", "e2e-statement.pdf");
  fs.writeFileSync(out, buf);
  console.log("wrote", out, buf.length, "bytes");

  const rows = await parsePdf(buf);
  const nameOf = Object.fromEntries(Object.entries(METRICS).map(([k, v]) => [v, k]));
  console.log(`\n${symbol} | ${best.title}`);
  for (const r of rows) {
    console.log(`  ${nameOf[r.metric] ?? r.metric} = ${r.value.toLocaleString("en-US")}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });

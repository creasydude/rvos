import fs from "fs";
import { searchLetters, pdfUrl, downloadPdf } from "../lib/market/codal";
import { periodEndFromTitle } from "../lib/market/jalaali";

// Load pdf-parse internally (lazy), same as parse.ts will.
async function getText(buf: Buffer): Promise<string> {
  const mod = await import("pdf-parse/lib/pdf-parse.js") as any;
  const fn = mod.default?.pdf ?? mod.default ?? mod.pdf;
  const r = await fn(buf);
  return r.text as string;
}

async function main() {
  // Find a فولاد ANNUAL statement (audited) for FY1404.
  const r = await searchLetters({ letterType: 6, fromDate: "1404/06/01", toDate: "1405/05/18", search: "فولاد", period: 12, page: 1 });
  console.log("total:", r.total);
  const annuals = r.letters.filter((l) => l.Title && periodEndFromTitle(l.Title) === "1404/12/29" && /سال مالی/.test(l.Title) && !/میاندوره/.test(l.Title ?? ""));
  console.log("annual 1404/12/29 matches:", annuals.length);
  if (!annuals.length) { console.log("sample titles:", r.letters.slice(0, 5).map((l) => l.Title)); return; }
  const pick = annuals[0];
  console.log("picked:", pick.Title);
  console.log("tracing:", pick.TracingNo, "url:", pdfUrl(pick));
  const buf = await downloadPdf(pdfUrl(pick)!);
  console.log("pdf size:", buf.byteLength);
  const text = await getText(Buffer.from(buf));
  console.log("text length:", text.length);
  fs.writeFileSync("/tmp/statement.txt", text);
  // Print the first 150 lines to see the layout.
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  console.log("non-empty lines:", lines.length);
  for (let i = 0; i < Math.min(lines.length, 120); i++) console.log(`[${i}] ${lines[i].slice(0, 130)}`);
}
main().catch((e) => { console.error("FATAL:", e); process.exit(1); });

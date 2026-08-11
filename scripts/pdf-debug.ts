// Dump every reconstructed row for a statement PDF: normalized label + all
// amount cells (x-sorted, current-period highlighted = highest x).
// Usage: npx tsx scripts/pdf-debug.ts [path]
import fs from "fs";
import { faDigits } from "../lib/market/jalaali";

const pdfjs = require("pdfjs-dist/legacy/build/pdf.js");
const P = process.argv[2] ?? "/tmp/rvosdata/e2e-statement.pdf";

function parseAmount(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const neg = s.startsWith("(") || s.includes(")(") || /^-/.test(s);
  const digits = faDigits(s.replace(/[()\-]/g, ""));
  if (!/\d/.test(digits)) return null;
  const n = Number(digits);
  return isFinite(n) ? (neg ? -n : n) : null;
}

(async () => {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(P)) }).promise;
  const rows: { p: number; y: number; cells: { s: string; x: number; amt: number | null }[] }[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const byY = new Map<number, { s: string; x: number; amt: number | null }[]>();
    for (const it of tc.items) {
      const str = (it.str ?? "").trim();
      if (!str) continue;
      const x = it.transform?.[4] ?? 0;
      const y = it.transform?.[5] ?? 0;
      const key = Math.round(y * 2) / 2;
      if (!byY.has(key)) byY.set(key, []);
      byY.get(key)!.push({ s: str, x, amt: parseAmount(str) });
    }
    for (const [y, cells] of byY) rows.push({ p, y, cells });
  }
  rows.sort((a, b) => a.p - b.p || b.y - a.y || (a.cells[0]?.x ?? 0) - (b.cells[0]?.x ?? 0));
  for (const r of rows) {
    const label = r.cells
      .filter((c) => c.amt == null)
      .sort((a, b) => a.x - b.x)
      .map((c) => c.s.normalize("NFKC"))
      .join(" ");
    const amts = r.cells
      .filter((c) => c.amt != null && /\d/.test(faDigits(c.s)))
      .map((c) => `${c.s}@x=${Math.round(c.x / 10)}`)
      .join(" | ");
    if (!label.trim()) continue;
    console.log(
      `p${r.p} ${JSON.stringify(label.slice(0, 70))}  ==>  ${amts || "(no amounts)"}`,
    );
  }
})().catch((e) => { console.error(e); process.exit(1); });
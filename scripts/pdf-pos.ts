import fs from "fs";
async function main() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.js") as any;
  const data = new Uint8Array(fs.readFileSync("/tmp/statement.pdf"));
  const doc = await pdfjs.getDocument({ data }).promise;
  const page = await doc.getPage(1);
  const tc = await page.getTextContent();
  const items = (tc.items as any[]).map((it) => ({
    str: (it.str ?? "").trim(),
    x: it.transform[4],
    y: it.transform[5],
  })).filter((i) => i.str);
  console.log("items:", items.length);
  // Group into rows by y, sort by y desc (PDF y grows upward), then x asc within row.
  const rows = new Map<number, typeof items>();
  for (const it of items) {
    const key = Math.round(it.y * 2) / 2;
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key)!.push(it);
  }
  for (const y of [...rows.keys()].sort((a, b) => b - a).slice(0, 60)) {
    const row = rows.get(y)!.sort((a, b) => a.x - b.x);
    console.log(`y=${y} | ${row.map((i) => `${i.str}@${i.x}`).join("  ")}`);
  }
}
main().catch((e) => { console.error("FATAL:", e); process.exit(1); });

import fs from "fs";
import { parseHtml } from "../lib/market/parse";

const files = [
  ["/tmp/annual-cache/فولاد.html", "فولاد"],
  ["/tmp/annual-cache/فملی.html", "فملی"],
  ["/tmp/annual-cache/شپنا.html", "شپنا"],
  ["/tmp/annual-cache/خودرو.html", "خودرو"],
  ["/tmp/annual-cache/وبملت.html", "وبملت"],
  ["/tmp/annual-cache/خبهمن.html", "خبهمن"],
  ["/tmp/annual-cache2/فولاد-len3.html", "فولاد-len3"],
  ["/tmp/cache-دانا.html", "دانا"],
  ["/tmp/annual-cache2/ملت-len12.html", "ملت"],
];
const fmt = (n: number) => (Math.abs(n) >= 1e12 ? (n / 1e12).toFixed(2) + "T" : Math.abs(n) >= 1e9 ? (n / 1e9).toFixed(1) + "B" : Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1) + "M" : String(n));

for (const [f, name] of files) {
  if (!fs.existsSync(f)) { console.log(`SKIP ${name}: no file`); continue; }
  const html = fs.readFileSync(f, "utf-8");
  const res = parseHtml(html);
  const m = Object.fromEntries(res.map((r) => [r.metric, r.value]));
  const A = m["total_assets"], L = m["total_liabilities"], E = m["shareholders_equity"];
  let id = "";
  if (A && L && E) { const d = Math.abs(A - (L + E)) / A; id = `A=L+E ${(d * 100).toFixed(2)}%`; }
  else if (A) id = "(no L/E)";
  const eps = m["eps"], ni = m["net_income"];
  let shares = "";
  if (eps && ni && eps !== 0) shares = `impliedShares=${fmt(Math.abs(ni / eps))}`;
  console.log(`\n── ${name}: ${id}${shares ? " " + shares : ""} nm=${Object.keys(m).length} ──`);
  const show = ["total_assets", "total_liabilities", "shareholders_equity", "revenue", "cogs", "ebit", "pre_tax_income", "net_income", "eps", "interest_expense", "operating_cash_flow", "capex", "retained_earnings", "total_debt"];
  for (const k of show) if (m[k] != null) console.log(`  ${k.padEnd(22)} ${fmt(m[k])}`);
}

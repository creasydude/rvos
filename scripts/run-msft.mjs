// One-shot: run a full real analysis on MSFT and save it as a viewable record.
const BASE = "http://localhost:3000";

const fundText = `Microsoft Corp (MSFT) FY2025:
Revenue $303.1B, Net income $97.3B, EBITDA $163.1B, Operating cash flow $121.5B,
Free cash flow $90.8B, Total assets $546.1B, Total liabilities $286.8B,
Total stockholders equity $259.3B, Shares outstanding 7.43B, EPS $13.09,
Book value per share $34.9, Current price $496, Dividend $3.32/share,
Dividend growth ~10%, Beta 0.9, Peer P/E ~34x, Peer EV/EBITDA ~22x,
Discount rate 8.5%, FCF growth 12%, terminal growth 3%, Net debt $45B`;

const techText = `MSFT daily closes last 3 months:
510.10 512.40 508.20 514.30 511.90 516.70 518.20 515.10 517.40 520.10
519.30 522.00 520.60 524.10 525.00 523.40 526.20 528.10 526.80 529.90
531.20 529.50 532.40 533.10 530.80 534.20 535.90 534.10 536.80 538.20
536.40 539.10 540.70 539.30 541.80 543.20 541.90 544.60 546.20 544.90
547.10 548.40 547.00 549.30 550.80 549.60 551.20 552.70 551.40 553.60
555.00 553.20 554.70 556.30 555.10 557.20 558.60 557.40 559.10 560.50
559.20 561.30 562.70 561.00 563.20 564.60 563.40 565.10 566.50 565.20
567.00 568.40 567.30 569.10 570.50 569.40 571.20 572.60 571.80 573.40
574.90 573.60 575.20 576.60 575.40 577.10 578.30 577.00 579.20 580.40
579.60 581.30 582.60 581.50 583.00 584.40 583.20 585.10 586.30 585.60`;

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  console.log("1) extracting fundamentals...");
  const fund = await post("/api/extract/fundamental", { text: fundText });
  const fp = JSON.stringify(fund.parsed);
  console.log("   keys:", Object.keys(fund.parsed).join(", "));

  console.log("2) extracting technicals...");
  const tech = await post("/api/extract/technical", { text: techText });
  const tp = JSON.stringify(tech.parsed);
  console.log("   npts:", (tech.parsed.close || []).length);

  console.log("3) analyzing (streaming)...");
  const ar = await fetch(`${BASE}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fundamental: fp, technical: tp }),
  });
  if (!ar.ok) throw new Error(`analyze: ${ar.status} ${await ar.text()}`);
  const reader = ar.body.getReader();
  const dec = new TextDecoder();
  let buf = "", full = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) !== -1) {
      const ev = buf.slice(0, i); buf = buf.slice(i + 2);
      for (const line of ev.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const p = line.slice(5).trim();
        if (p === "[DONE]") continue;
        const j = JSON.parse(p);
        if (j.delta) full += j.delta;
      }
    }
  }
  console.log("   streamed chars:", full.length);

  console.log("4) saving as viewable analysis...");
  const saved = await post("/api/analyses", {
    kind: "analysis",
    title: "MSFT",
    ticker: "MSFT",
    body: full,
  });
  console.log(`\nDONE. Open the analysis in the frontend:\n  http://localhost:3000/?id=${saved.id}`);
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
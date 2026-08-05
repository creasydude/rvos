// Streaming analyze E2E smoke test.
const BASE = "http://localhost:3000";
const fundamental = {
  ticker: "AAPL", price: 214, sharesOutstanding: "15.06B", netIncome: "93.7B",
  revenue: "391.0B", ebitda: "130.9B", totalAssets: "364.9B", totalLiabilities: "302.8B",
  shareholdersEquity: "62.1B", fcf: "108.6B", operatingCashFlow: "118.3B",
  dividendsPerShare: "1.00", eps: "6.22", pePeer: "28x",
  fcfGrowthRate: "8%", discountRate: "9%", terminalGrowthRate: "3%",
};
const technical = {
  ticker: "AAPL", interval: "daily",
  close: [214.1, 215.3, 213.9, 216.0, 217.2, 216.5, 218.1, 217.4, 219.0, 220.1,
          219.5, 221.0, 220.4, 222.1, 223.0, 222.5, 224.0, 225.1, 224.6, 226.0],
};

async function main() {
  const res = await fetch(`${BASE}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fundamental: JSON.stringify(fundamental), technical: JSON.stringify(technical) }),
  });
  console.log("HTTP:", res.status);
  if (!res.ok) { console.log(await res.text()); return; }

  const reader = res.body.getReader();
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
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        const j = JSON.parse(payload);
        if (j.delta) full += j.delta;
        if (j.done) { console.log("COMPLETE"); }
      }
    }
  }
  console.log("STREAMED CHARS:", full.length);
  console.log("-----PREVIEW-----");
  console.log(full.slice(0, 1800));
}
main().catch((e) => { console.error(e); process.exit(1); });
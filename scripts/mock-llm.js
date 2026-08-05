// Mock OpenAI-compatible chat completions server for E2E testing.
// POST /v1/chat/completions with stream:true → SSE chunks.
const http = require("http");

// If the prompt asks to extract fundamentals, return a structured notes JSON.
// If it asks for synthesis, return a streaming bear/base/bull write-up.
function responseFor(messages) {
  const sys = messages[0]?.content ?? "";
  const user = messages[1]?.content ?? "";
  if (sys.includes("reformat raw, messy, pasted financial data")) {
    return JSON.stringify({
      ticker: "TEST",
      price: 100,
      eps: 5,
      bookValuePerShare: 20,
      salesPerShare: 50,
      pePeer: 15,
      ev: 1200,
      ebitda: 200,
      evEbitdaPeer: 10,
      netIncome: 50,
      revenue: 500,
      totalAssets: 1000,
      shareholdersEquity: 400,
      totalLiabilities: 600,
      retainedEarnings: 100,
      ebit: 80,
      currentAssets: 200,
      currentLiabilities: 150,
      fcf: 60,
      fcfGrowthRate: 0.05,
      discountRate: 0.1,
      terminalGrowthRate: 0.03,
      netDebt: 200,
      dividendsPerShare: 1,
      dividendGrowthRate: 0.04,
      sharesOutstanding: 10,
      notes: ["test note"],
    });
  }
  if (sys.includes("pasted price/chart data") || sys.includes("pasted chart/price data")) {
    // rising series 100..149
    const close = Array.from({ length: 50 }, (_, i) => 100 + i);
    return JSON.stringify({ ticker: "TEST", close, interval: "daily" });
  }
  if (sys.includes("final research write-up")) {
    return [
      "**TL;DR** — Test analysis.",
      "**Bear case** — Numbers point down.",
      "**Base case** — Most likely path.",
      "**Bull case** — What could go right.",
      "**Key assumptions** — discount rate, growth.",
      "**What's missing** — nothing.",
    ].join("\n\n");
  }
  return "unknown system prompt";
}

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.method !== "POST" || !req.url.includes("/chat/completions")) {
      res.writeHead(404).end("nf");
      return;
    }
    let parsed;
    try { parsed = JSON.parse(body); } catch { res.writeHead(400).end("bad json"); return; }
    const content = responseFor(parsed.messages ?? []);
    const full = content.split("");

    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    // Simulate streaming: emit one character every 10ms.
    let i = 0;
    const timer = setInterval(() => {
      if (i < full.length) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: full[i] } }] })}\n\n`);
        i++;
      } else {
        res.write("data: [DONE]\n\n");
        clearInterval(timer);
        res.end();
      }
    }, 10);
  });
});

server.listen(9999, () => console.log("mock LLM listening on :9999"));

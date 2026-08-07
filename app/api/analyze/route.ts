import { NextRequest } from "next/server";
import { streamAnalysis } from "@/lib/analyze";
import { saveAnalysis } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const fundamental = typeof body.fundamental === "string" ? body.fundamental : undefined;
  const technical = typeof body.technical === "string" ? body.technical : undefined;

  if (!fundamental && !technical) {
    return new Response(JSON.stringify({ error: "Need at least one side" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  let result: { stream: ReadableStream<string>; context: { fundamental?: string; technical?: string; brain: string; ticker?: string } };
  try {
    result = await streamAnalysis({ fundamental, technical });
  } catch (e) {
    console.error("ANALYZE THREW:", e);
    return new Response(JSON.stringify({ error: (e as Error).message || "Analysis failed" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { stream, context } = result;
  const encoder = new TextEncoder();

  // Pipe the analysis stream to the client while buffering the full text, then
  // persist it server-side (with the full context) on completion so the follow
  // up chat can cite the underlying data. Return the saved id in the done event.
  const sse = new ReadableStream({
    async start(controller) {
      const reader = stream.getReader();
      let full = "";
      let savedId: string | undefined;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) full += value;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: value })}\n\n`));
      }
      try {
        savedId = crypto.randomUUID();
        saveAnalysis({
          id: savedId,
          ticker: context.ticker,
          title: context.ticker ? `${context.ticker} analysis` : "Analysis",
          kind: "analysis",
          body: full,
          fundamental: context.fundamental,
          technical: context.technical,
          brain: context.brain,
          createdAt: Date.now(),
        });
      } catch (e) {
        console.error("SAVE ANALYSIS THREW:", e);
      }
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, id: savedId })}\n\n`));
      controller.close();
    },
    cancel() {
      stream.cancel?.().catch(() => {});
    },
  });

  return new Response(sse, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
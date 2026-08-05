import { NextRequest } from "next/server";
import { streamAnalysis } from "@/lib/analyze";

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

  let stream: ReadableStream<string>;
  try {
    stream = await streamAnalysis({ fundamental, technical });
  } catch (e) {
    console.error("ANALYZE THREW:", e);
    return new Response(JSON.stringify({ error: (e as Error).message || "Analysis failed" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const sse = new ReadableStream({
    async start(controller) {
      const reader = stream.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: value })}\n\n`));
      }
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
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

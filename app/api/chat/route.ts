import { NextRequest } from "next/server";
import { getAnalysis, getRoleAssignments, listChatMessages, saveChatMessage } from "@/lib/db";
import { streamComplete } from "@/lib/llm";
import { buildChatSystem } from "@/lib/prompts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HISTORY_LIMIT = 20;

/** All prior Q&A for an analysis, oldest first — used to reseed the thread. */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const analysisId = url.searchParams.get("analysisId");
  if (!analysisId) {
    return new Response(JSON.stringify({ error: "analysisId required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify(listChatMessages(analysisId)), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const analysisId = typeof body.analysisId === "string" ? body.analysisId : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";

  if (!analysisId || !message) {
    return new Response(JSON.stringify({ error: "analysisId and message required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const analysis = getAnalysis(analysisId);
  if (!analysis) {
    return new Response(JSON.stringify({ error: "analysis not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const roles = getRoleAssignments();
  if (!roles.synthesis) {
    return new Response(JSON.stringify({ error: "No synthesis endpoint assigned — configure in Settings" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // The system prompt carries the entire stock dataset; the conversation
  // messages are the prior Q&A (already grounded in that data) plus the new
  // question. The LLM only reasons in prose over the supplied numbers.
  // The readable narrative is embedded in the fundamental JSON (market write-ups);
  // surface it as its own labeled section so chat mines it like synthesis does.
  let narrative: string | undefined;
  if (analysis.fundamental?.trim()) {
    try {
      const f = JSON.parse(analysis.fundamental);
      if (typeof f?.narrative === "string") narrative = f.narrative;
    } catch {
      /* not JSON — nothing to surface */
    }
  }
  const system = buildChatSystem({
    fundamental: analysis.fundamental,
    technical: analysis.technical,
    narrative,
    brain: analysis.brain ?? "",
    writeup: analysis.body,
  });

  // Annotate the mapped type explicitly so `role` stays a literal union
  // ("user" | "assistant") instead of widening to `string` — which would break
  // the contextually-typed messages array below.
  const history: { role: "user" | "assistant"; content: string }[] = listChatMessages(analysisId, HISTORY_LIMIT).map((m) => ({
    role: m.role === "user" ? "user" : "assistant",
    content: m.content,
  }));

  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: system },
    ...history,
    { role: "user", content: message },
  ];

  let stream: ReadableStream<string>;
  try {
    stream = await streamComplete({ system, user: message, endpointId: roles.synthesis, messages });
  } catch (e) {
    console.error("CHAT THREW:", e);
    return new Response(JSON.stringify({ error: (e as Error).message || "Chat failed" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Persist the user's question immediately; buffer the reply and save it once
  // streaming finishes.
  saveChatMessage({
    id: crypto.randomUUID(),
    analysisId,
    role: "user",
    content: message,
    createdAt: Date.now(),
  });

  const encoder = new TextEncoder();
  const sse = new ReadableStream({
    async start(controller) {
      const reader = stream.getReader();
      let full = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) full += value;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: value })}\n\n`));
      }
      if (full.trim()) {
        saveChatMessage({
          id: crypto.randomUUID(),
          analysisId,
          role: "assistant",
          content: full,
          createdAt: Date.now(),
        });
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

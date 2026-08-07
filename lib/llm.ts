import { getEndpoint } from "./db";

export type Provider = "openai" | "openai-compatible" | "anthropic" | "gemini";

// Default base URLs per provider (all OpenAI-compatible endpoints; the
// provider field only selects the default baseUrl + default auth shape).
const DEFAULT_BASE: Record<Provider, string> = {
  openai: "https://api.openai.com/v1",
  "openai-compatible": "https://api.example.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
};

export function baseUrlFor(provider: Provider, override?: string): string {
  return (override ?? DEFAULT_BASE[provider]).replace(/\/$/, "");
}

export type LlmMessage = { role: "system" | "user" | "assistant"; content: string };

/** Default messages for a one-shot call: system then a single user turn. */
function defaultMessages(params: { system: string; user: string; messages?: LlmMessage[] }): LlmMessage[] {
  return params.messages ?? [
    { role: "system", content: params.system },
    { role: "user", content: params.user },
  ];
}

/**
 * Single chat-completion call against any OpenAI-compatible endpoint.
 * Pass `messages` to supply an explicit turn history (system + prior Q&A +
 * the new user turn); otherwise it builds a one-shot system+user call.
 */
export async function complete(params: {
  system: string;
  user: string;
  endpointId: string;
  messages?: LlmMessage[];
}): Promise<string> {
  return consume(await streamComplete(params));
}

/**
 * Streams a completion. Returns a Promise that resolves with an
 * (async-iterable) ReadableStream of text deltas and rejects if the
 * provider returns a non-2xx.
 */
export async function streamComplete(params: {
  system: string;
  user: string;
  endpointId: string;
  messages?: LlmMessage[];
}): Promise<ReadableStream<string>> {
  const ep = getEndpoint(params.endpointId);
  if (!ep) throw new Error("Endpoint not found");
  const base = baseUrlFor(ep.provider as Provider, ep.baseUrl);

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ep.apiKey}`,
    },
    body: JSON.stringify({
      model: ep.model,
      stream: true,
      messages: defaultMessages(params),
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Provider error ${res.status}: ${text.slice(0, 500)}`);
  }
  if (!res.body) throw new Error("No response body");

  // OpenAI-compatible SSE: `data: {...}\n\n`, with `data: [DONE]` terminator.
  return parseSSE(res.body, (data) => {
    if (!data.startsWith("data:")) return "";
    const payload = data.slice(5).trim();
    if (payload === "[DONE]") return "";
    try {
      const json = JSON.parse(payload);
      const delta = json.choices?.[0]?.delta?.content;
      return typeof delta === "string" ? delta : "";
    } catch {
      return "";
    }
  });
}

export async function consume(stream: ReadableStream<string>): Promise<string> {
  const reader = stream.getReader();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) out += value;
  }
  return out;
}

/** Parses an SSE body into a stream of text deltas extracted by `pick`. */
async function parseSSE(body: ReadableStream<Uint8Array>, pick: (line: string) => string): Promise<ReadableStream<string>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  return new ReadableStream({
    async start(controller) {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf("\n\n")) !== -1) {
            const event = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            for (const line of event.split("\n")) {
              if (line.startsWith("data:")) {
                const text = pick(line);
                if (text) controller.enqueue(text);
              }
            }
          }
        }
      } catch (e) {
        controller.error(e);
        return;
      }
      controller.close();
    },
    cancel() {
      reader.cancel().catch(() => {});
    },
  });
}

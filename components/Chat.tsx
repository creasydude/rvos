"use client";

import { Box, Button, Flex, Text, Textarea } from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";
import Markdown from "./Markdown";

export type RoleStatus = { fundamental: boolean; technical: boolean; synthesis: boolean };

type PasteKind = "fundamental" | "technical";

type Msg =
  | { role: "user"; text: string; label: string }
  | { role: "assistant"; text: string; label: "analysis" | "notes"; kind?: PasteKind }
  | { role: "error"; text: string };

function parseSSE(res: Response, onDelta: (d: string) => void): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let full = "";
  return new Promise((resolve, reject) => {
    (async () => {
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
                const payload = line.slice(5).trim();
                if (payload === "[DONE]") continue;
                try {
                  const json = JSON.parse(payload);
                  if (json.delta) {
                    onDelta(json.delta);
                    full += json.delta;
                  }
                  if (json.done) resolve(full);
                } catch {}
              }
            }
          }
        }
        resolve(full);
      } catch (e) {
        reject(e);
      }
    })();
  });
}

export default function Chat({ roles, initialAnalysis }: { roles: RoleStatus; initialAnalysis?: string }) {
  const [msgs, setMsgs] = useState<Msg[]>(
    initialAnalysis
      ? [{ role: "assistant", text: initialAnalysis, label: "analysis" }]
      : [],
  );

  useEffect(() => {
    if (initialAnalysis) setMsgs([{ role: "assistant", text: initialAnalysis, label: "analysis" }]);
  }, [initialAnalysis]);

  const [paste, setPaste] = useState<PasteKind | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const streamedRef = useRef<string>("");

  const push = (m: Msg) => setMsgs((prev) => [...prev, m]);
  const replaceLastAssistant = (fn: (m: Extract<Msg, { role: "assistant" }>) => Extract<Msg, { role: "assistant" }>) =>
    setMsgs((prev) => {
      const copy = [...prev];
      const i = copy.findIndex((m) => m.role === "assistant");
      if (i !== -1) copy[i] = fn(copy[i] as Extract<Msg, { role: "assistant" }>);
      return copy;
    });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, paste]);

  const notesOf = (kind: PasteKind): string | undefined => {
    let found: string | undefined;
    for (const m of msgs) {
      if (m.role === "assistant" && m.label === "notes" && m.kind === kind) found = m.text;
    }
    return found;
  };

  const submitPaste = async () => {
    if (!paste || busy) return;
    const label = paste === "fundamental" ? "Fundamental data" : "Technical data";
    push({ role: "user", text: pasteText, label });
    setBusy(true);
    setPaste(null);
    setPasteText("");
    streamedRef.current = "";
    push({ role: "assistant", text: "", label: "notes", kind: paste });

    try {
      const res = await fetch(`/api/extract/${paste}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: pasteText }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Extract failed");
      }
      const data = await res.json();
      if (!data.parsed) {
        push({ role: "error", text: "The skill returned text that didn't parse as JSON — here's the raw output:\n" + data.raw });
      } else {
        replaceLastAssistant((m) => ({ ...m, text: JSON.stringify(data.parsed, null, 2) }));
      }
    } catch (e) {
      push({ role: "error", text: (e as Error).message });
    }
    setBusy(false);
  };

  const analyze = async () => {
    if (busy) return;
    const fundamental = notesOf("fundamental");
    const technical = notesOf("technical");
    if (!fundamental && !technical) return;
    setBusy(true);
    streamedRef.current = "";
    push({ role: "assistant", text: "", label: "analysis" });

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fundamental, technical }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Analysis failed");
      }
      await parseSSE(res, (delta) => {
        streamedRef.current += delta;
        replaceLastAssistant((m) => ({ ...m, text: streamedRef.current }));
      });
      if (streamedRef.current.trim()) {
        fetch("/api/analyses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "analysis", title: "Analysis", body: streamedRef.current }),
        }).catch(() => {});
      }
    } catch (e) {
      push({ role: "error", text: (e as Error).message });
    }
    setBusy(false);
  };

  const canAnalyze = (() => {
    const has = { fundamental: false, technical: false };
    for (const m of msgs) {
      if (m.role === "assistant" && m.label === "notes" && m.kind) has[m.kind] = true;
    }
    return has.fundamental || has.technical;
  })();

  return (
    <Flex flex="1" h="100vh" flexDir="column" minW="0">
      <Box flex="1" overflowY="auto">
        <Box maxW="720px" mx="auto" px={4} py={8} spaceY={4}>
          {msgs.length === 0 && (
            <Box py={16} textAlign="center" color="muted">
              <Text fontSize="lg" color="ink">Paste fundamental and/or technical data</Text>
              <Text mt={1} fontSize="sm">
                The skills will extract structured notes, then the brain computes and the synthesis writes the analysis.
              </Text>
            </Box>
          )}

          {msgs.map((m, i) => (
            <Box
              key={i}
              maxW="85%"
              p={3}
              rounded="lg"
              whiteSpace="pre-wrap"
              fontSize="sm"
              lineHeight="relaxed"
              alignSelf={m.role === "user" ? "flex-end" : "flex-start"}
              bg={m.role === "user" ? "accent" : m.role === "error" ? "red.950/60" : "surface"}
              color={m.role === "user" ? "white" : m.role === "error" ? "red.300" : "ink"}
              borderWidth={m.role === "user" ? 0 : 1}
              borderColor={m.role === "error" ? "red.800" : "borderC"}
            >
              {m.role === "assistant" && (
                <Text mb={1} fontSize="xs" fontWeight="medium" color="muted">
                  {m.label === "analysis" ? "Analysis" : m.label === "notes" ? (m.kind === "technical" ? "Technical notes" : "Fundamental notes") : ""}
                </Text>
              )}
              {m.role === "assistant" && m.label === "analysis" ? (
                m.text === "" && busy ? (
                  <Text color="muted" animation="pulse 2s ease-in-out infinite">Analyzing…</Text>
                ) : (
                  <Markdown>{m.text}</Markdown>
                )
              ) : (
                m.text
              )}
            </Box>
          ))}
          <div ref={bottomRef} />
        </Box>
      </Box>

      <Box borderTopWidth="1px" borderColor="borderC" bg="bg">
        <Box maxW="720px" mx="auto" px={4} py={4}>
          {paste === null ? (
            <Flex align="center" justify="space-between" gap={3} wrap="wrap">
              <Flex gap={2} wrap="wrap">
                <Button
                  onClick={() => setPaste("fundamental")}
                  disabled={busy || !roles.fundamental}
                  variant="outline"
                  borderColor="borderC"
                  bg="surface"
                  size="sm"
                  color="ink"
                  _hover={{ bg: "raised" }}
                  title={!roles.fundamental ? "Assign a fundamental endpoint in Settings" : undefined}
                >
                  Add fundamental data
                </Button>
                <Button
                  onClick={() => setPaste("technical")}
                  disabled={busy || !roles.technical}
                  variant="outline"
                  borderColor="borderC"
                  bg="surface"
                  size="sm"
                  color="ink"
                  _hover={{ bg: "raised" }}
                  title={!roles.technical ? "Assign a technical endpoint in Settings" : undefined}
                >
                  Add technical data
                </Button>
                <Button
                  onClick={analyze}
                  disabled={busy || !canAnalyze || !roles.synthesis}
                  colorScheme="accent"
                  size="sm"
                  title={!roles.synthesis ? "Assign a synthesis endpoint in Settings" : undefined}
                >
                  Analyze
                </Button>
              </Flex>
              <Text fontSize="11px" color="muted">Research tool, not financial advice.</Text>
            </Flex>
          ) : (
            <Box>
              <Flex align="center" justify="space-between" mb={2}>
                <Text fontSize="sm" fontWeight="medium">
                  {paste === "fundamental" ? "Paste fundamental data" : "Paste technical data"}
                </Text>
                <Button variant="ghost" size="xs" color="muted" onClick={() => setPaste(null)}>
                  Cancel
                </Button>
              </Flex>
              <Textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={paste === "fundamental"
                  ? "Paste income statement, balance sheet, cash flow, valuation metrics…"
                  : "Paste price data — one close per line, or date,open,high,low,close,volume rows…"}
                h="160px"
                resize="none"
                bg="surface"
                borderColor="borderC"
                color="ink"
                _placeholder={{ color: "muted" }}
                _focus={{ borderColor: "accent" }}
              />
              <Flex justify="flex-end" mt={2}>
                <Button
                  onClick={submitPaste}
                  disabled={busy || pasteText.trim() === ""}
                  colorScheme="accent"
                  size="sm"
                >
                  Extract notes
                </Button>
              </Flex>
            </Box>
          )}
        </Box>
      </Box>
    </Flex>
  );
}

"use client";

import { Box, Button, Flex, Text, Textarea } from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";
import Markdown from "./Markdown";
import { isRtlText } from "@/lib/rtl";

export type RoleStatus = { fundamental: boolean; technical: boolean; synthesis: boolean };

type PasteKind = "fundamental" | "technical";

type Msg =
  | { role: "user"; text: string; label: string }
  | { role: "assistant"; text: string; label: "analysis" | "notes"; kind?: PasteKind }
  | { role: "error"; text: string };

type ChatMsg = { role: "user" | "assistant"; text: string };

/** Parses the app's SSE (data: {"delta":...} … {"done":true, "id":...}). */
function parseSSE(res: Response, onDelta: (d: string) => void): Promise<{ text: string; id?: string }> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let full = "";
  let outId: string | undefined;
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
                  if (json.done) {
                    if (json.id) outId = json.id;
                    resolve({ text: full, id: json.id });
                  }
                } catch {}
              }
            }
          }
        }
        resolve({ text: full, id: outId });
      } catch (e) {
        reject(e);
      }
    })();
  });
}

export default function Chat({
  roles,
  initialAnalysis,
  analysisId,
  analysisTicker,
  onOpenMenu,
}: {
  roles: RoleStatus;
  initialAnalysis?: string;
  analysisId?: string | null;
  analysisTicker?: string;
  onOpenMenu?: () => void;
}) {
  const [msgs, setMsgs] = useState<Msg[]>(
    initialAnalysis
      ? [{ role: "assistant", text: initialAnalysis, label: "analysis" }]
      : [],
  );

  useEffect(() => {
    if (initialAnalysis) setMsgs([{ role: "assistant", text: initialAnalysis, label: "analysis" }]);
  }, [initialAnalysis]);

  // The analysis we can chat with: either the one loaded from history (prop)
  // or a freshly completed analysis (set when /api/analyze returns its id).
  const [activeId, setActiveId] = useState<string | null>(analysisId ?? null);
  useEffect(() => {
    setActiveId(analysisId ?? null);
  }, [analysisId]);

  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);

  // Load persisted Q&A when an analysis is opened.
  useEffect(() => {
    if (!activeId) {
      setChatMsgs([]);
      return;
    }
    let alive = true;
    fetch(`/api/chat?analysisId=${activeId}`)
      .then((r) => r.json())
      .then((d) => {
        if (alive && Array.isArray(d)) setChatMsgs(d.map((m: any) => ({ role: m.role, text: m.content })));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [activeId]);

  const [paste, setPaste] = useState<PasteKind | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const streamedRef = useRef<string>("");

  const push = (m: Msg) => setMsgs((prev) => [...prev, m]);
  const replaceLastAssistant = (fn: (m: Extract<Msg, { role: "assistant" }>) => Extract<Msg, { role: "assistant" }>) =>
    setMsgs((prev) => {
      const copy = [...prev];
      // Target the most recent assistant bubble (index from the end). The old
      // code used findIndex, which matched the FIRST assistant bubble — so a
      // fresh extraction/stream would overwrite an earlier notes bubble and the
      // live text never showed up where it belonged.
      for (let i = copy.length - 1; i >= 0; i--) {
        if (copy[i].role === "assistant") {
          copy[i] = fn(copy[i] as Extract<Msg, { role: "assistant" }>);
          break;
        }
      }
      return copy;
    });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, paste, chatMsgs]);

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
      const { id } = await parseSSE(res, (delta) => {
        streamedRef.current += delta;
        replaceLastAssistant((m) => ({ ...m, text: streamedRef.current }));
      });
      // The server persists the analysis (with its full context); unlock chat.
      if (id) setActiveId(id);
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

  const replaceLastChat = (fn: (m: ChatMsg) => ChatMsg) =>
    setChatMsgs((prev) => {
      const copy = [...prev];
      if (copy.length && copy[copy.length - 1].role === "assistant") {
        copy[copy.length - 1] = fn(copy[copy.length - 1]);
      }
      return copy;
    });

  const sendChat = async () => {
    const text = chatInput.trim();
    if (!text || chatBusy || !activeId) return;
    setChatInput("");
    setChatMsgs((p) => [...p, { role: "user", text }]);
    setChatBusy(true);
    setChatMsgs((p) => [...p, { role: "assistant", text: "" }]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysisId: activeId, message: text }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Chat failed");
      }
      await parseSSE(res, (delta) => {
        replaceLastChat((m) => ({ ...m, text: m.text + delta }));
      });
    } catch (e) {
      replaceLastChat((m) => ({ ...m, text: (m.text ? m.text : "") + "\n\n_(Error: " + (e as Error).message + ")_" }));
    }
    setChatBusy(false);
  };

  const hasAnalysis = activeId !== null;

  return (
    <Flex flex="1" h="100vh" flexDir="column" minW="0">
      {/* Mobile top bar with hamburger (hidden on md+) */}
      <Flex
        display={{ base: "flex", md: "none" }}
        align="center"
        px={3}
        py={2}
        borderBottomWidth="1px"
        borderColor="borderC"
        bg="surface"
      >
        <Box as="button" onClick={onOpenMenu} aria-label="Open menu" color="ink" p={1}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </Box>
        <Text ml={2} fontWeight="semibold" color="ink" fontSize="sm">Research Tool</Text>
      </Flex>

      <Box flex="1" overflowY="auto">
        <Box maxW={{ base: "100%", lg: "1040px" }} mx="auto" px={{ base: 3, md: 4 }} py={8} spaceY={4}>
          {msgs.length === 0 && chatMsgs.length === 0 && (
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
              maxW={{ base: "92%", md: "85%" }}
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
              // Analysis bubbles render inside <Markdown>, which sets its own
              // direction; raw-text bubbles (pastes, notes, errors) get theirs
              // here so Persian output reads right-to-left.
              dir={m.role === "assistant" && m.label === "analysis" ? undefined : isRtlText(m.text) ? "rtl" : "ltr"}
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
              ) : m.role === "assistant" && m.label === "notes" && m.text === "" && busy ? (
                <Text color="muted" animation="pulse 2s ease-in-out infinite">Extracting…</Text>
              ) : (
                m.text
              )}
            </Box>
          ))}

          {/* Follow-up chat thread (rendered below the analysis) */}
          {chatMsgs.map((m, i) => (
            <Box
              key={`chat-${i}`}
              maxW={{ base: "92%", md: "85%" }}
              p={3}
              rounded="lg"
              whiteSpace="pre-wrap"
              fontSize="sm"
              lineHeight="relaxed"
              alignSelf={m.role === "user" ? "flex-end" : "flex-start"}
              bg={m.role === "user" ? "accent" : "surface"}
              color={m.role === "user" ? "white" : "ink"}
              borderWidth={m.role === "user" ? 0 : 1}
              borderColor="borderC"
              dir={m.role === "assistant" ? undefined : isRtlText(m.text) ? "rtl" : "ltr"}
            >
              {m.role === "user" ? (
                m.text
              ) : m.text === "" && chatBusy ? (
                <Text color="muted" animation="pulse 2s ease-in-out infinite">Thinking…</Text>
              ) : (
                <Markdown>{m.text}</Markdown>
              )}
            </Box>
          ))}
          <div ref={bottomRef} />
        </Box>
      </Box>

      <Box borderTopWidth="1px" borderColor="borderC" bg="bg">
        <Box maxW={{ base: "100%", lg: "1040px" }} mx="auto" px={{ base: 3, md: 4 }} py={4}>
          {hasAnalysis ? (
            /* Follow-up chat over the analysis */
            <Box>
              <Flex align="center" justify="space-between" mb={2}>
                <Text fontSize="sm" fontWeight="medium" color="ink">
                  {analysisTicker ? `Ask about ${analysisTicker.toUpperCase()}` : "Ask about this stock"}
                </Text>
                <Text fontSize="11px" color="muted">Research tool, not financial advice.</Text>
              </Flex>
              <Textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendChat();
                  }
                }}
                placeholder="Ask about the data — e.g. what's the DCF implying, how sensitive is the bull case, what metric is missing…"
                rows={2}
                resize="none"
                bg="surface"
                borderColor="borderC"
                color="ink"
                _placeholder={{ color: "muted" }}
                _focus={{ borderColor: "accent" }}
                disabled={chatBusy}
              />
              <Flex justify="flex-end" mt={2}>
                <Button onClick={sendChat} disabled={chatBusy || chatInput.trim() === ""} colorScheme="accent" size="sm">
                  {chatBusy ? "Answering…" : "Send"}
                </Button>
              </Flex>
            </Box>
          ) : paste === null ? (
            <Flex align="center" justify="space-between" gap={3} wrap="wrap">
              <Flex gap={2} wrap="wrap" w={{ base: "100%", md: "auto" }} justify={{ base: "center", md: "flex-start" }}>
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
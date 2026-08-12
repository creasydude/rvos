"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Flex,
  Heading,
  Input,
  Separator,
  Spinner,
  TabsContent,
  TabsList,
  TabsRoot,
  TabsTrigger,
  Text,
  VStack,
} from "@chakra-ui/react";

type Counts = Record<string, number>;
type Instrument = { symbol: string; insCode: string; name: string | null };

type Status = { instruments: Instrument[]; counts: Counts };

type SyncResult = {
  ok: boolean;
  insCode?: string;
  symbol?: string;
  reason?: string;
  bars?: number;
  adjusts?: number;
  shares?: number;
  flows?: number;
  statements?: number;
  fundamentalItems?: number;
  reports?: number;
};

type LogEntry = { id: number; kind: "ok" | "err" | "info"; text: string };

type ScenarioResult = {
  scenarioId: string;
  scenarioName: string;
  description: string;
  dcf: {
    intrinsicValuePerShare?: number;
    enterpriseValue?: number;
    equityValue?: number;
    pvCashFlows?: number;
    warnings: string[];
  };
  bridge: {
    revenue?: { name: string; baseValue?: number; scenarioValue?: number; delta?: number; unit?: string }[];
    ebitda?: { name: string; baseValue?: number; scenarioValue?: number; delta?: number; unit?: string }[];
    fcf?: { name: string; baseValue?: number; scenarioValue?: number; delta?: number; unit?: string }[];
  };
  sensitivity: {
    discountRate: { discountRate?: number; intrinsicValuePerShare?: number }[];
    terminalGrowth: { terminalGrowth?: number; intrinsicValuePerShare?: number }[];
    exitMultiple: { exitMultiple?: number; intrinsicValuePerShare?: number }[];
  };
  assumptions: {
    macro: { key: string; value: number; unit: string; description?: string }[];
    company: { key: string; value: number; unit: string; description?: string }[];
  };
  probability?: number;
  probabilityWeightedValue?: number;
  warnings: string[];
};

type ScenarioOutput = {
  symbol?: string;
  name?: string;
  baseCase: {
    revenue: number;
    ebitda?: number;
    ebitdaMargin?: number;
    fcf?: number;
    price?: number;
  };
  baseValuation?: {
    dcfPerShare?: number;
    price?: number;
    marginOfSafety?: number;
  };
  results: ScenarioResult[];
  expectedValue?: number;
  warnings: string[];
};

const COUNT_LABELS: [string, string][] = [
  ["instruments", "Instruments"],
  ["daily_bars", "Daily bars"],
  ["quotes_snapshot", "Quotes"],
  ["price_adjustments", "Price adjustments"],
  ["share_changes", "Share changes"],
  ["client_flows", "Client flows"],
  ["codal_letters", "Codal letters"],
  ["statement_docs", "Statement PDFs"],
  ["fundamentals", "Fundamental line items"],
  ["codal_reports", "Important reports"],
];

let logId = 0;

export default function MarketPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [symbol, setSymbol] = useState("");
  const [analyzeSymbol, setAnalyzeSymbol] = useState("");
  const [analysis, setAnalysis] = useState<Record<string, unknown> | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [writeup, setWriteup] = useState("");
  const [writeupBusy, setWriteupBusy] = useState(false);
  const [writeupId, setWriteupId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [scenarioSymbol, setScenarioSymbol] = useState("");
  const [scenarioOutput, setScenarioOutput] = useState<ScenarioOutput | null>(null);
  const [scenarioBusy, setScenarioBusy] = useState(false);
  const [thesisText, setThesisText] = useState("");
  const [thesisBusy, setThesisBusy] = useState(false);
  const [thesisId, setThesisId] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    const r = await fetch("/api/market").then((r) => r.json()).catch(() => null);
    if (r && typeof r === "object") setStatus(r as Status);
  }, []);

  const deleteAll = useCallback(async () => {
    try {
      const r = await fetch("/api/market", { method: "DELETE" }).then((r) => r.json()).catch(() => null);
      if (r?.ok) {
        push("ok", "✔ All market data deleted");
        setDeleteConfirm(false);
        await refresh();
      } else {
        push("err", `✖ Delete failed: ${r?.error ?? "unknown"}`);
      }
    } catch (e) {
      push("err", `✖ Delete threw: ${(e as Error).message}`);
    }
  }, [refresh]);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  const push = (kind: LogEntry["kind"], text: string) => {
    setLog((l) => [...l.slice(-200), { id: ++logId, kind, text }]);
  };

  // Copy a calcs section to clipboard as `name = value [unit]` lines, with a
  // transient "Copied ✓" label on the button that initiated it.
  const copyCalcs = async (section: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(section);
      setTimeout(() => setCopied((c) => (c === section ? null : c)), 1600);
    } catch {
      setCopied(null); // clipboard unavailable (non-secure context) — fail silently
    }
  };

  // Calcs → clipboard text: one `name = value [unit]` line per calc.
  const calcsText = (cs: { name: string; value: number; unit?: string }[] | undefined) =>
    (cs ?? []).map((c) => `${c.name} = ${c.value != null ? c.value.toFixed(3) : "N/A"}${c.unit ? ` ${c.unit}` : ""}`).join("\n");

  const runAnalyze = async (sym: string) => {
    if (analysing) return;
    setAnalysing(true);
    setAnalysis(null);
    push("info", `▶ analyze ${sym} …`);
    try {
      const res = await fetch(`/api/market/analyze?symbol=${encodeURIComponent(sym)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) push("err", `✖ analyze ${sym}: ${data.error ?? res.status}`);
      else {
        setAnalysis(data);
        const t = (data as { technical?: { calcs: { name: string }[] } }).technical?.calcs?.length ?? 0;
        const f = (data as { fundamental?: { calcs: { name: string }[] } }).fundamental?.calcs?.length ?? 0;
        push("ok", `✔ analyze ${sym}: ${t} technical calcs, ${f} fundamental calcs (last ${(data as { lastPrice?: number | null }).lastPrice})`);
      }
    } catch (e) {
      push("err", `✖ analyze ${sym} threw: ${(e as Error).message}`);
    }
    setAnalysing(false);
  };

  // AI write-up: POST /api/analyze {symbol} — the route builds the enriched rial
  // notes (brain ratios + statement/report context) and streams the synthesis
  // LLM's write-up; the saved analysis id enables the "Open in chat" link.
  const runWriteup = async (sym: string) => {
    if (writeupBusy) return;
    setWriteupBusy(true);
    setWriteup("");
    setWriteupId(null);
    push("info", `▶ AI write-up ${sym} …`);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: sym }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        push("err", `✖ AI write-up ${sym}: ${data.error ?? res.status}`);
        return;
      }
      const { id } = await parseSSE(res, (delta) => setWriteup((w) => w + delta));
      setWriteupId(id ?? null);
      push("ok", `✔ AI write-up ${sym} done${id ? ` — open in chat (id ${id.slice(0, 8)}…)` : ""}`);
    } catch (e) {
      push("err", `✖ AI write-up ${sym} threw: ${(e as Error).message}`);
    }
    setWriteupBusy(false);
  };

  const runScenarios = async (sym: string) => {
    if (scenarioBusy) return;
    setScenarioBusy(true);
    setScenarioOutput(null);
    push("info", `▶ scenarios ${sym} …`);
    try {
      const res = await fetch(`/api/market/scenarios?symbol=${encodeURIComponent(sym)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) push("err", `✖ scenarios ${sym}: ${data.error ?? res.status}`);
      else {
        setScenarioOutput(data.output);
        const n = data.output?.results?.length ?? 0;
        push("ok", `✔ scenarios ${sym}: ${n} scenarios computed`);
      }
    } catch (e) {
      push("err", `✖ scenarios ${sym} threw: ${(e as Error).message}`);
    }
    setScenarioBusy(false);
  };

  const synthesizeThesis = async (sym: string) => {
    if (thesisBusy) return;
    setThesisBusy(true);
    setThesisText("");
    setThesisId(null);
    push("info", `▶ synthesizing scenario thesis for ${sym} …`);
    try {
      const res = await fetch("/api/market/scenarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: sym }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        push("err", `✖ synthesis ${sym}: ${data.error ?? res.status}`);
        setThesisBusy(false);
        return;
      }
      const { text, id } = await parseSSE(res, (d) => setThesisText((t) => t + d));
      setThesisId(id ?? null);
      push("ok", `✔ scenario thesis generated`);
    } catch (e) {
      push("err", `✖ synthesis threw: ${(e as Error).message}`);
    }
    setThesisBusy(false);
  };

  const runSync = async (payload: Record<string, unknown>, label: string) => {
    if (busy) return;
    setBusy(label);
    push("info", `▶ ${label} …`);
    try {
      const res = await fetch("/api/market", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        push("err", `✖ ${label} failed: ${data.error ?? res.status}`);
      } else if (payload.action === "syncCodal") {
        const parsed = data.parsed ?? { instruments: 0, items: 0 };
        push("ok", `✔ Codal: ${data.stored} filings stored, ${data.downloaded} statement PDFs, ${parsed.instruments} instrument(s) parsed → ${parsed.items} fundamental line items`);
      } else if (payload.symbol) {
        const r = data as SyncResult;
        push(r.ok ? "ok" : "err",
          r.ok
            ? `✔ ${r.symbol ?? payload.symbol}: ${r.bars} bars, ${r.adjusts} adjusts, ${r.shares} share events, ${r.flows} flow days` +
              (r.statements != null ? ` · ${r.statements} statements → ${r.fundamentalItems ?? 0} fundamental line items` : "") +
              (r.reports != null ? ` · ${r.reports} important reports` : "")
            : `✖ ${payload.symbol}: ${r.reason}`);
      } else {
        push("ok", `✔ EOD gather: ${data.succeeded}/${data.total} instruments gathered`);
        for (const r of (data.results ?? []) as SyncResult[]) {
          if (!r.ok) push("err", `  ✖ ${r.symbol ?? r.insCode}: ${r.reason}`);
        }
      }
      await refresh();
    } catch (e) {
      push("err", `✖ ${label} threw: ${(e as Error).message}`);
    }
    setBusy(null);
  };

  return (
    <Box h="100dvh" overflowY="auto">
      <Box maxW="1080px" mx="auto" px={{ base: 3, md: 5 }} py={8} color="ink">
      <Flex mb={6} align="center" justify="space-between" wrap="wrap" gap={3}>
        <Box>
          <Heading size="lg">Iran Stocks Data</Heading>
          <Text mt={1} fontSize="sm" color="muted">
            Pull Tehran market data into RVOS and learn how the brain turns it into numbers.
          </Text>
        </Box>
        <Link href="/" style={{ color: "#a0a0ac", textDecoration: "none" }} onMouseEnter={(e) => (e.currentTarget.style.color = "#e8e8ec")} onMouseLeave={(e) => (e.currentTarget.style.color = "#a0a0ac")}>
          ← Back to chat
        </Link>
      </Flex>

      <TabsRoot defaultValue="sync" size="lg">
        <TabsList mb={4}>
          <TabsTrigger value="sync">Gather Data</TabsTrigger>
          <TabsTrigger value="scenarios">Scenarios</TabsTrigger>
          <TabsTrigger value="education">Education</TabsTrigger>
        </TabsList>

        {/* ---------------- SYNC ---------------- */}
        <TabsContent value="sync">
          <VStack align="stretch" spaceY={6}>
            {/* Actions */}
            <Box p={4} borderWidth="1px" borderColor="borderC" rounded="md" bg="surface">
              <Heading size="sm" mb={3}>Gather data</Heading>
              <Flex gap={2} wrap="wrap" align="center">
                <Input
                  placeholder="Symbol or insCode (e.g. فولاد)"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && symbol.trim() && runSync({ action: "sync", symbol: symbol.trim() }, `gather ${symbol.trim()}`)}
                  bg="bg"
                  borderColor="borderC"
                  maxW="260px"
                />
                <Button
                  colorScheme="accent"
                  size="sm"
                  disabled={!symbol.trim() || !!busy}
                  onClick={() => symbol.trim() && runSync({ action: "sync", symbol: symbol.trim() }, `gather ${symbol.trim()}`)}
                >
                  Gather data
                </Button>
                <Button
                  variant="outline"
                  borderColor="borderC"
                  size="sm"
                  disabled={!!busy}
                  onClick={() => runSync({ action: "sync" }, "gather all instruments")}
                >
                  Gather all data
                </Button>
                <Button
                  variant="outline"
                  borderColor="borderC"
                  size="sm"
                  disabled={!!busy}
                  onClick={() => runSync({ action: "syncCodal", days: 30, limit: 40, download: true }, "gather recent Codal filings")}
                >
                  Gather recent Codal filings
                </Button>
                {busy && (
                  <Flex align="center" gap={2} fontSize="sm" color="muted">
                    <Spinner size="sm" /> {busy}
                  </Flex>
                )}
              </Flex>
            </Box>

            {/* Status + instruments */}
            {status && (
              <Box p={4} borderWidth="1px" borderColor="borderC" rounded="md" bg="surface">
                <Flex align="center" justify="space-between" mb={3}>
                  <Heading size="sm">Database status</Heading>
                  <Flex gap={1}>
                    <Button size="xs" variant="ghost" color="muted" onClick={() => refresh()}>
                      Refresh
                    </Button>
                    {!deleteConfirm ? (
                      <Button size="xs" variant="ghost" color="red.300" onClick={() => setDeleteConfirm(true)}>
                        Delete all data
                      </Button>
                    ) : (
                      <Flex gap={1} align="center">
                        <Text fontSize="xs" color="red.300">Are you sure?</Text>
                        <Button size="xs" variant="solid" colorPalette="red" onClick={() => deleteAll()}>
                          Confirm
                        </Button>
                        <Button size="xs" variant="ghost" color="muted" onClick={() => setDeleteConfirm(false)}>
                          Cancel
                        </Button>
                      </Flex>
                    )}
                  </Flex>
                </Flex>
                <Flex wrap="wrap" gap={2} mb={4}>
                  {COUNT_LABELS.map(([key, label]) => {
                    const v = status.counts[key];
                    return (
                      <Box key={key} minW="150px" p={3} borderWidth="1px" borderColor="borderC" rounded="md" bg="bg">
                        <Text fontSize="xl" fontWeight="semibold" color="accent.300">
                          {v == null ? "—" : v < 0 ? "n/a" : v.toLocaleString()}
                        </Text>
                        <Text fontSize="xs" color="muted">{label}</Text>
                      </Box>
                    );
                  })}
                </Flex>

                <Separator my={4} borderColor="borderC" />

                <Heading size="xs" color="muted" mb={2}>Known instruments ({status.instruments.length})</Heading>
                {status.instruments.length === 0 && (
                  <Text fontSize="sm" color="muted">No instruments yet — gather data for a symbol to start.</Text>
                )}
                <Flex direction="column" gap={1}>
                  {status.instruments.slice(0, 200).map((inst) => (
                    <Flex key={inst.insCode} justify="space-between" fontSize="sm" px={1} py={0.5} _hover={{ bg: "raised" }} rounded="sm">
                      <Text fontWeight="medium">{inst.symbol}</Text>
                      <Text color="muted" truncate>{inst.name ?? inst.insCode}</Text>
                    </Flex>
                  ))}
                </Flex>
              </Box>
            )}

            {/* Analyze */}
            <Box p={4} borderWidth="1px" borderColor="borderC" rounded="md" bg="surface">
              <Heading size="sm" mb={1}>Analyze a symbol</Heading>
              <Text fontSize="xs" color="muted" mb={3}>
                Loads the stored bars + any parsed fundamentals for a symbol and runs the brain on them
                (technical: RSI/MACD/ADX/SMA… — available after gathering data; fundamental: needs a parsed
                statement PDF in <code>fundamentals</code>).
              </Text>
              <Flex gap={2} wrap="wrap" align="center">
                <Input
                  placeholder="Symbol already gathered (e.g. فولاد)"
                  value={analyzeSymbol}
                  onChange={(e) => setAnalyzeSymbol(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && analyzeSymbol.trim() && runAnalyze(analyzeSymbol.trim())}
                  bg="bg"
                  borderColor="borderC"
                  maxW="260px"
                />
                <Button
                  colorScheme="accent"
                  size="sm"
                  disabled={!analyzeSymbol.trim() || analysing}
                  onClick={() => analyzeSymbol.trim() && runAnalyze(analyzeSymbol.trim())}
                >
                  {analysing ? "Analyzing…" : "Analyze"}
                </Button>
                <Button
                  variant="outline"
                  borderColor="borderC"
                  size="sm"
                  disabled={!analyzeSymbol.trim() || writeupBusy}
                  onClick={() => analyzeSymbol.trim() && runWriteup(analyzeSymbol.trim())}
                >
                  {writeupBusy ? "Writing…" : "AI write-up"}
                </Button>
              </Flex>

              {writeup && (
                <Box mt={4}>
                  <Flex align="center" justify="space-between" mb={1}>
                    <Text fontSize="xs" color="muted">AI write-up (gathered data + statement context → synthesis LLM)</Text>
                    {writeupId && (
                      <Link href={`/?id=${writeupId}`} style={{ color: "#e8e8ec", textDecoration: "none", fontSize: "12px" }}>
                        Open in chat ↗
                      </Link>
                    )}
                  </Flex>
                  <Box fontSize="xs" lineHeight="1.7" whiteSpace="pre-wrap" fontFamily="body" bg="bg" p={3} borderWidth="1px" borderColor="borderC" rounded="md" maxH="420px" overflowY="auto">
                    {writeup}
                  </Box>
                </Box>
              )}

              {analysis && (
                <Box mt={4} fontSize="xs" fontFamily="mono" lineHeight="1.7">
                  <Text color="muted">
                    last close = {String(analysis.lastPrice)} · bars = {String(analysis.bars)}
                    {analysis.fiscalYear != null ? ` · fiscal year = ${String(analysis.fiscalYear)}` : " · no fundamentals parsed"}
                  </Text>
                  {(analysis.technical as { calcs: { name: string; value: number; unit?: string }[] })?.calcs?.length ? (
                    <Box mt={2}>
                      <Flex align="center" justify="space-between" mb={1}>
                        <Text color="accent.300" fontWeight="semibold">Technical calcs</Text>
                        <Button
                          size="xs"
                          variant="outline"
                          borderColor="borderC"
                          height="22px"
                          onClick={() => copyCalcs("technical", calcsText((analysis.technical as { calcs: { name: string; value: number; unit?: string }[] })?.calcs))}
                        >
                          {copied === "technical" ? "Copied ✓" : "Copy"}
                        </Button>
                      </Flex>
                      {(analysis.technical as { calcs: { name: string; value: number; unit?: string }[] }).calcs.map((c) => (
                        <Text key={c.name}>{c.name} = {c.value != null ? c.value.toFixed(3) : "N/A"}</Text>
                      ))}
                    </Box>
                  ) : null}
                  {(analysis.fundamental as { calcs: { name: string; value: number; unit?: string }[] })?.calcs?.length ? (
                    <Box mt={2}>
                      <Flex align="center" justify="space-between" mb={1}>
                        <Text color="accent.300" fontWeight="semibold">Fundamental calcs</Text>
                        <Button
                          size="xs"
                          variant="outline"
                          borderColor="borderC"
                          height="22px"
                          onClick={() => copyCalcs("fundamental", calcsText((analysis.fundamental as { calcs: { name: string; value: number; unit?: string }[] })?.calcs))}
                        >
                          {copied === "fundamental" ? "Copied ✓" : "Copy"}
                        </Button>
                      </Flex>
                      {(analysis.fundamental as { calcs: { name: string; value: number; unit?: string }[] }).calcs.map((c) => (
                        <Text key={c.name}>{c.name} = {c.value != null ? c.value.toFixed(3) : "N/A"}</Text>
                      ))}
                    </Box>
                  ) : null}
                  {(analysis.fundamental as { populated?: string[] })?.populated?.length ? (
                    <Box mt={2}>
                      <Text color="accent.300" fontWeight="semibold" mb={1}>Fundamental inputs loaded</Text>
                      <Text>{(analysis.fundamental as { populated?: string[] }).populated!.join(", ")}</Text>
                    </Box>
                  ) : null}
                  {(analysis.fundamental as { warnings?: string[] })?.warnings?.length ? (
                    <Box mt={2}>
                      <Text color="yellow.300" fontWeight="semibold" mb={1}>Fundamental warnings</Text>
                      {(analysis.fundamental as { warnings?: string[] }).warnings!.map((w) => (
                        <Text key={w} color="yellow.200">⚠ {w}</Text>
                      ))}
                    </Box>
                  ) : null}
                  <FundamentalContext context={((analysis.fundamental as { context?: unknown }).context ?? null) as FContext | null} />
                </Box>
              )}
            </Box>

            {/* Log */}
            <Box p={4} borderWidth="1px" borderColor="borderC" rounded="md" bg="surface">
              <Heading size="sm" mb={3}>Activity log</Heading>
              <Box ref={logRef} maxH="260px" overflowY="auto" fontSize="xs" fontFamily="mono" lineHeight="1.7">
                {log.length === 0 && <Text color="muted">Nothing yet — gather data to populate this.</Text>}
                {log.map((e) => (
                  <Text key={e.id} color={e.kind === "err" ? "red.300" : e.kind === "ok" ? "green.300" : "muted"}>
                    {e.text}
                  </Text>
                ))}
              </Box>
            </Box>
          </VStack>
        </TabsContent>

        {/* ---------------- SCENARIOS ---------------- */}
        <TabsContent value="scenarios">
          <VStack align="stretch" spaceY={6}>
            <Box p={4} borderWidth="1px" borderColor="borderC" rounded="md" bg="surface">
              <Heading size="sm" mb={1}>Macro Regime Scenario Analysis</Heading>
              <Text fontSize="xs" color="muted" mb={3}>
                Run 4 preset macro scenarios (persistent sanctions, partial normalization, full normalization,
                severe deterioration) on a symbol&apos;s synced fundamental data. Each scenario projects
                financials over 5 years and computes DCF valuations, sensitivity tables, and an operating bridge.
              </Text>
              <Flex gap={2} wrap="wrap" align="center">
                <Input
                  placeholder="Symbol already gathered (e.g. فولاد)"
                  value={scenarioSymbol}
                  onChange={(e) => setScenarioSymbol(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && scenarioSymbol.trim() && runScenarios(scenarioSymbol.trim())}
                  bg="bg"
                  borderColor="borderC"
                  maxW="260px"
                />
                <Button
                  colorScheme="accent"
                  size="sm"
                  disabled={!scenarioSymbol.trim() || scenarioBusy}
                  onClick={() => scenarioSymbol.trim() && runScenarios(scenarioSymbol.trim())}
                >
                  {scenarioBusy ? "Running…" : "Run scenarios"}
                </Button>
              </Flex>
            </Box>

            {scenarioOutput && (
              <>
                {/* Base case summary */}
                <Box p={4} borderWidth="1px" borderColor="borderC" rounded="md" bg="surface">
                  <Heading size="sm" mb={2}>Base case</Heading>
                  <Flex wrap="wrap" gap={3}>
                    <Stat label="Revenue" value={fmtRial(scenarioOutput.baseCase.revenue)} />
                    {scenarioOutput.baseCase.ebitda != null && <Stat label="EBITDA" value={fmtRial(scenarioOutput.baseCase.ebitda)} />}
                    {scenarioOutput.baseCase.ebitdaMargin != null && <Stat label="EBITDA margin" value={`${(scenarioOutput.baseCase.ebitdaMargin * 100).toFixed(1)}%`} />}
                    {scenarioOutput.baseCase.fcf != null && <Stat label="FCF" value={fmtRial(scenarioOutput.baseCase.fcf)} />}
                    {scenarioOutput.baseValuation?.dcfPerShare != null && <Stat label="DCF intrinsic" value={fmtRial(scenarioOutput.baseValuation.dcfPerShare)} />}
                    {scenarioOutput.expectedValue != null && <Stat label="Expected value" value={fmtRial(scenarioOutput.expectedValue)} />}
                  </Flex>
                </Box>

                {/* Scenario comparison table */}
                <Box p={4} borderWidth="1px" borderColor="borderC" rounded="md" bg="surface">
                  <Heading size="sm" mb={3}>Scenario comparison</Heading>
                  <Box overflowX="auto">
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid var(--chakra-colors-borderC)" }}>
                          <th style={{ textAlign: "left", padding: "6px 8px", color: "var(--chakra-colors-muted)" }}>Scenario</th>
                          <th style={{ textAlign: "right", padding: "6px 8px", color: "var(--chakra-colors-muted)" }}>DCF /share</th>
                          <th style={{ textAlign: "right", padding: "6px 8px", color: "var(--chakra-colors-muted)" }}>Discount rate</th>
                          <th style={{ textAlign: "right", padding: "6px 8px", color: "var(--chakra-colors-muted)" }}>Terminal growth</th>
                          <th style={{ textAlign: "right", padding: "6px 8px", color: "var(--chakra-colors-muted)" }}>Warnings</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scenarioOutput.results.map((r) => {
                          const macro = Object.fromEntries(r.assumptions.macro.map((a) => [a.key, a.value]));
                          return (
                            <tr key={r.scenarioId} style={{ borderBottom: "1px solid var(--chakra-colors-borderC)" }}>
                              <td style={{ padding: "6px 8px" }}>
                                <Text fontWeight="semibold" fontSize="xs">{r.scenarioName}</Text>
                                <Text fontSize="10px" color="muted">{r.description}</Text>
                              </td>
                              <td style={{ textAlign: "right", padding: "6px 8px", fontFamily: "mono" }}>
                                {r.dcf.intrinsicValuePerShare != null ? fmtRial(r.dcf.intrinsicValuePerShare) : "—"}
                              </td>
                              <td style={{ textAlign: "right", padding: "6px 8px", fontFamily: "mono" }}>
                                {macro.discountRate != null ? `${(macro.discountRate * 100).toFixed(1)}%` : "—"}
                              </td>
                              <td style={{ textAlign: "right", padding: "6px 8px", fontFamily: "mono" }}>
                                {macro.terminalGrowthRate != null ? `${(macro.terminalGrowthRate * 100).toFixed(1)}%` : "—"}
                              </td>
                              <td style={{ textAlign: "right", padding: "6px 8px", fontSize: "10px", color: r.warnings.length ? "var(--chakra-colors-yellow-300)" : "var(--chakra-colors-muted)" }}>
                                {r.warnings.length ? `${r.warnings.length}⚠` : "none"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </Box>
                </Box>

                {/* Per-scenario details */}
                {scenarioOutput.results.map((r) => (
                  <Box key={r.scenarioId} p={4} borderWidth="1px" borderColor="borderC" rounded="md" bg="surface">
                    <Heading size="sm" mb={2}>{r.scenarioName}</Heading>
                    <Text fontSize="xs" color="muted" mb={3}>{r.description}</Text>

                    {/* Key assumptions */}
                    {r.assumptions.macro.length > 0 && (
                      <Box mb={3}>
                        <Text fontSize="xs" color="accent.300" fontWeight="semibold" mb={1}>Macro assumptions</Text>
                        <Flex wrap="wrap" gap={1}>
                          {r.assumptions.macro.map((a) => (
                            <Badge key={a.key} variant="outline" borderColor="accent.400" color="accent.300" fontSize="10px" px={1.5} py={0.5}>
                              {a.key}: {fmtVal(a.value, a.unit)}
                            </Badge>
                          ))}
                        </Flex>
                      </Box>
                    )}
                    {r.assumptions.company.length > 0 && (
                      <Box mb={3}>
                        <Text fontSize="xs" color="accent.300" fontWeight="semibold" mb={1}>Company assumptions</Text>
                        <Flex wrap="wrap" gap={1}>
                          {r.assumptions.company.map((a) => (
                            <Badge key={a.key} variant="outline" borderColor="blue.400" color="blue.300" fontSize="10px" px={1.5} py={0.5}>
                              {a.key}: {fmtVal(a.value, a.unit)}
                            </Badge>
                          ))}
                        </Flex>
                      </Box>
                    )}

                    {/* Bridge */}
                    {r.bridge.revenue && r.bridge.revenue.length > 0 && (
                      <Box mb={3}>
                        <Text fontSize="xs" color="accent.300" fontWeight="semibold" mb={1}>Revenue bridge</Text>
                        {r.bridge.revenue.map((b) => (
                          <Flex key={b.name} justify="space-between" fontSize="xs">
                            <Text>{b.name}</Text>
                            <Text fontFamily="mono" color="muted">
                              {b.baseValue != null ? fmtRial(b.baseValue) : ""}{b.scenarioValue != null ? ` → ${fmtRial(b.scenarioValue)}` : ""}{b.delta != null ? ` (${b.delta >= 0 ? "+" : ""}${fmtRial(b.delta)})` : ""}
                            </Text>
                          </Flex>
                        ))}
                      </Box>
                    )}
                    {r.bridge.ebitda && r.bridge.ebitda.length > 0 && (
                      <Box mb={3}>
                        <Text fontSize="xs" color="accent.300" fontWeight="semibold" mb={1}>EBITDA bridge</Text>
                        {r.bridge.ebitda.map((b) => (
                          <Flex key={b.name} justify="space-between" fontSize="xs">
                            <Text>{b.name}</Text>
                            <Text fontFamily="mono" color="muted">
                              {b.baseValue != null ? (b.unit === "%" ? `${b.baseValue.toFixed(1)}%` : fmtRial(b.baseValue)) : ""}
                              {b.scenarioValue != null ? ` → ${b.unit === "%" ? `${b.scenarioValue.toFixed(1)}%` : fmtRial(b.scenarioValue)}` : ""}
                              {b.delta != null ? ` (${b.delta >= 0 ? "+" : ""}${b.unit === "pp" ? `${b.delta.toFixed(1)}pp` : fmtRial(b.delta)})` : ""}
                            </Text>
                          </Flex>
                        ))}
                      </Box>
                    )}

                    {/* Sensitivity */}
                    {r.sensitivity.discountRate.length > 0 && (
                      <Box mb={3}>
                        <Text fontSize="xs" color="accent.300" fontWeight="semibold" mb={1}>Sensitivity: discount rate</Text>
                        <Flex wrap="wrap" gap={2}>
                          {r.sensitivity.discountRate.map((s) => (
                            <Badge key={s.discountRate} variant="outline" borderColor="borderC" fontSize="10px" px={1.5} py={0.5}>
                              {(s.discountRate! * 100).toFixed(0)}% → {s.intrinsicValuePerShare != null ? fmtRial(s.intrinsicValuePerShare) : "—"}
                            </Badge>
                          ))}
                        </Flex>
                      </Box>
                    )}
                    {r.sensitivity.terminalGrowth.length > 0 && (
                      <Box mb={3}>
                        <Text fontSize="xs" color="accent.300" fontWeight="semibold" mb={1}>Sensitivity: terminal growth</Text>
                        <Flex wrap="wrap" gap={2}>
                          {r.sensitivity.terminalGrowth.map((s) => (
                            <Badge key={s.terminalGrowth} variant="outline" borderColor="borderC" fontSize="10px" px={1.5} py={0.5}>
                              {(s.terminalGrowth! * 100).toFixed(0)}% → {s.intrinsicValuePerShare != null ? fmtRial(s.intrinsicValuePerShare) : "—"}
                            </Badge>
                          ))}
                        </Flex>
                      </Box>
                    )}
                    {r.sensitivity.exitMultiple.length > 0 && (
                      <Box mb={3}>
                        <Text fontSize="xs" color="accent.300" fontWeight="semibold" mb={1}>Sensitivity: exit multiple</Text>
                        <Flex wrap="wrap" gap={2}>
                          {r.sensitivity.exitMultiple.map((s) => (
                            <Badge key={s.exitMultiple} variant="outline" borderColor="borderC" fontSize="10px" px={1.5} py={0.5}>
                              {s.exitMultiple}x → {s.intrinsicValuePerShare != null ? fmtRial(s.intrinsicValuePerShare) : "—"}
                            </Badge>
                          ))}
                        </Flex>
                      </Box>
                    )}

                    {r.warnings.length > 0 && (
                      <Box>
                        <Text fontSize="xs" color="yellow.300" fontWeight="semibold" mb={1}>Warnings</Text>
                        {r.warnings.map((w, i) => (
                          <Text key={i} fontSize="xs" color="yellow.200">⚠ {w}</Text>
                        ))}
                      </Box>
                    )}
                  </Box>
                ))}

                {scenarioOutput.warnings.length > 0 && (
                  <Box p={4} borderWidth="1px" borderColor="borderC" rounded="md" bg="surface">
                    <Heading size="sm" mb={2} color="yellow.300">Global warnings</Heading>
                    {scenarioOutput.warnings.map((w, i) => (
                      <Text key={i} fontSize="xs" color="yellow.200">⚠ {w}</Text>
                    ))}
                  </Box>
                )}

                {/* AI Investment Thesis */}
                <Box p={4} borderWidth="1px" borderColor="borderC" rounded="md" bg="surface">
                  <Flex justify="space-between" align="center" mb={3}>
                    <Heading size="sm">AI Investment Thesis</Heading>
                    <Button
                      size="xs"
                      variant="outline"
                      borderColor="accent.400"
                      color="accent.300"
                      disabled={thesisBusy || !scenarioSymbol.trim()}
                      onClick={() => synthesizeThesis(scenarioSymbol.trim())}
                    >
                      {thesisBusy ? "Synthesizing…" : "Generate AI thesis"}
                    </Button>
                  </Flex>
                  {thesisText && (
                    <Box whiteSpace="pre-wrap" fontSize="sm" color="ink" lineHeight="tall">
                      {thesisText}
                    </Box>
                  )}
                  {thesisId && (
                    <Flex mt={3} fontSize="xs" align="center" gap={2}>
                      <Badge colorPalette="green">Saved</Badge>
                      <Link href={`/?id=${thesisId}`} style={{ color: "#e8e8ec", textDecoration: "none", fontSize: "12px" }}>
                        Open in chat ↗
                      </Link>
                    </Flex>
                  )}
                </Box>
              </>
            )}
          </VStack>
        </TabsContent>

        {/* ---------------- EDUCATION ---------------- */}
        <TabsContent value="education">
          <VStack align="stretch" spaceY={6}>
            <Box p={4} borderWidth="1px" borderColor="borderC" rounded="md" bg="surface">
              <Heading size="sm" mb={2}>How the market data pipeline works</Heading>
              <Text fontSize="sm" color="ink" mb={3}>
                RVOS computes its models from two official Iranian market sources. An end-of-day ETL
                pulls the data into the app&apos;s SQLite database, and the brain loaders turn those
                stored rows into the exact input shapes the mathematical models expect.
              </Text>
              <Flex direction="column" gap={3}>
                <Step n="1" title="Pull (TSETMC — technicals)">
                  cdn.tsetmc.com supplies OHLCV bars, price adjustments, share changes and client-type
                  flow history for every instrument. See lib/market/tsetmc.ts.
                </Step>
                <Step n="2" title="Pull (Codal — fundamentals)">
                  search.codal.ir returns filing metadata for periodic statements; the statement PDFs are
                  downloaded and filed under data/filings/. See lib/market/codal.ts + lib/market/sync.ts.
                </Step>
                <Step n="3" title="Store (SQLite)">
                  Idempotent upserts land normalized rows in instruments, daily_bars, price_adjustments,
                  share_changes, client_flows, quotes_snapshot, codal_letters, statement_docs and
                  fundamentals. See lib/market/schema.ts.
                </Step>
                <Step n="4" title="Parse (PDF → line items)">
                  Statement PDFs are parsed into the fixed metric vocabulary (net_income, revenue, cogs,
                  …) keyed by instrument + fiscal year. See lib/market/parse.ts.
                </Step>
                <Step n="5" title="Load (brain inputs)">
                  loadTechnicalInputs reads bars into close/high/low/open/volume arrays; loadFundamentalInputs
                  reconstructs FundamentalInputs (+ prior-year for F-Score) and auto-fills peer ratios from
                  the sector average. See lib/market/load.ts.
                </Step>
                <Step n="6" title="Compute (the brain)">
                  The loaded inputs feed the fundamental and technical models in brain/ — every calc is
                  traceable back to its inputs. See brain/fundamental.ts + brain/technical.ts.
                </Step>
              </Flex>
            </Box>

            <Box p={4} borderWidth="1px" borderColor="borderC" rounded="md" bg="surface">
              <Heading size="sm" mb={3}>Fundamental models</Heading>
              <Flex wrap="wrap" gap={3}>
                <ModelCard
                  name="P/E ratio"
                  formula="price / eps"
                  note="Uses the latest EPS (or TSETMC's estimated EPS when the filing EPS isn't available yet)."
                />
                <ModelCard
                  name="EV/EBITDA"
                  formula="(marketCap + netDebt) / ebitda"
                  note="Sector EBITDA multiple; peer inputs auto-fill from the instrument's sector P/E."
                />
                <ModelCard
                  name="P/B ratio"
                  formula="price / bookValuePerShare"
                  note="bookValuePerShare is derived as shareholdersEquity ÷ sharesOutstanding."
                />
                <ModelCard
                  name="P/S ratio"
                  formula="price / salesPerShare"
                  note="salesPerShare is derived as revenue ÷ sharesOutstanding."
                />
                <ModelCard
                  name="Graham number"
                  formula="√(22.5 × eps × bookValuePerShare)"
                  note="Classic value ceiling; needs positive eps and book value."
                />
                <ModelCard
                  name="DDM (Gordon)"
                  formula="dividendsPerShare / (discountRate − dividendGrowthRate)"
                  note="Requires a dividend and a discount rate."
                />
                <ModelCard
                  name="DCF"
                  formula="Σ fcfᵢ/(1+r)ⁱ + terminal"
                  note="Uses fcfProjection when present, else fcf × (1 + fcfGrowthRate) growing to the horizon."
                />
                <ModelCard
                  name="DuPont ROE"
                  formula="netIncome/shareholdersEquity"
                  note="Decomposed into margin × asset turnover × leverage."
                />
                <ModelCard
                  name="Altman Z-Score"
                  formula="1.2A + 1.4B + 3.3C + 0.6D + 1.0E"
                  note="Bankruptcy-distance composite of working capital, retained earnings, EBIT, equity and sales."
                />
                <ModelCard
                  name="Piotroski F-Score"
                  formula="9 binary signals across profitability, leverage and efficiency"
                  note="Compares the current year to the prior year's statement."
                />
              </Flex>
            </Box>

            <Box p={4} borderWidth="1px" borderColor="borderC" rounded="md" bg="surface">
              <Heading size="sm" mb={3}>Technical indicators</Heading>
              <Text fontSize="sm" color="muted" mb={3}>
                Computed over the stored daily close series (with high/low/open/volume when present):
              </Text>
              <Flex wrap="wrap" gap={2}>
                {[
                  "SMA 20/50/200", "EMA 12/26", "MACD", "RSI 14", "Bollinger Bands",
                  "Stochastic %K/%D", "ATR 14", "ADX 14", "OBV", "VWAP",
                  "Price Z-score", "Linear regression slope", "Support & resistance",
                ].map((t) => (
                  <Badge key={t} colorPalette="accent" variant="subtle" px={2} py={1} fontSize="xs">
                    {t}
                  </Badge>
                ))}
              </Flex>
            </Box>

            <Box p={4} borderWidth="1px" borderColor="borderC" rounded="md" bg="surface">
              <Heading size="sm" mb={2}>What happens after gathering data</Heading>
              <Text fontSize="sm" color="muted">
                Gathered instruments become available to the chat pipeline: paste fundamental notes into a
                new analysis and the brain (plus the configured LLM roles) will reason over the same
                precomputed numbers shown here. Every number remains traceable to a stored input.
              </Text>
            </Box>

            <Text fontSize="11px" color="muted">
              Research tool, not financial advice — all outputs are estimates based on assumptions you can inspect.
            </Text>
          </VStack>
        </TabsContent>
      </TabsRoot>
      </Box>
    </Box>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <Flex gap={3} align="flex-start">
      <Box minW="22px" h="22px" rounded="full" bg="accent.600" color="white" fontSize="xs" fontWeight="bold" display="flex" alignItems="center" justifyContent="center" mt="2px">
        {n}
      </Box>
      <Box>
        <Text fontSize="sm" fontWeight="medium">{title}</Text>
        <Text fontSize="xs" color="muted" mt={0.5}>{children}</Text>
      </Box>
    </Flex>
  );
}

function ModelCard({ name, formula, note }: { name: string; formula: string; note: string }) {
  return (
    <Box w={{ base: "100%", sm: "48%", lg: "31%" }} p={3} borderWidth="1px" borderColor="borderC" rounded="md" bg="bg">
      <Text fontSize="sm" fontWeight="semibold">{name}</Text>
      <Text fontSize="xs" fontFamily="mono" color="accent.300" mt={1}>{formula}</Text>
      <Text fontSize="xs" color="muted" mt={1}>{note}</Text>
    </Box>
  );
}

// ---- LLM fundamental context (the statement/report bundle the AI write-up uses) ----

type FLineItem = { metric: string; label: string; value: number; fy: number };
type FReport = { kind: string; title: string; published: string | null; excerpt: string; keyPoints?: string[] };
type FContext = {
  symbol: string | null;
  name: string | null;
  fy: number | null;
  periodEnd: string | null;
  lineItems: FLineItem[];
  statement: { title: string; periodEnd: string | null; excerpt: string; rawLength?: number; keyPoints?: string[] } | null;
  reports: FReport[];
  units: string;
};

/** The LLM context as a plain-text blob — mirrors what the panel displays, so
 *  Copy == exactly what the AI write-up sees (line items + statement/report excerpts). */
function serializeContext(context: FContext): string {
  const parts: string[] = [];
  let header = context.symbol ?? "";
  if (context.name) header += ` — ${context.name}`;
  if (context.fy != null) header += ` · FY ${context.fy}`;
  if (context.periodEnd) header += ` · period ${context.periodEnd}`;
  if (context.units === "rial") header += " · values in rial";
  parts.push(header);

  if (context.lineItems.length) {
    parts.push("Line items:");
    for (const li of context.lineItems) parts.push(`${li.label} = ${li.value.toLocaleString("en-US")} ریال · FY ${li.fy}`);
  }

  if (context.statement) {
    parts.push(`Statement — ${context.statement.title}${context.statement.periodEnd ? ` (${context.statement.periodEnd})` : ""}`);
    if (context.statement.keyPoints?.length) {
      parts.push("Key points:");
      for (const kp of context.statement.keyPoints) parts.push(`- ${kp}`);
    }
    parts.push(context.statement.excerpt || "(no narrative text stored — gather data to re-download the PDF)");
  }

  for (const r of context.reports) {
    parts.push(`${kindLabel(r.kind)} — ${r.title}${r.published ? ` (${r.published})` : ""}`);
    if (r.keyPoints?.length) {
      parts.push("Key points:");
      for (const kp of r.keyPoints) parts.push(`- ${kp}`);
    }
    parts.push(r.excerpt || "(no text)");
  }
  return parts.join("\n");
}

function FundamentalContext({ context }: { context: FContext | null }) {
  const [ctxCopied, setCtxCopied] = useState(false);
  if (!context) return null;
  if (!context.lineItems.length && !context.statement && !context.reports.length) return null;
  const copyContext = async () => {
    try {
      await navigator.clipboard.writeText(serializeContext(context));
      setCtxCopied(true);
      setTimeout(() => setCtxCopied(false), 1600);
    } catch {
      setCtxCopied(false); // clipboard unavailable — fail silently
    }
  };
  return (
    <Box mt={2} fontSize="xs" lineHeight="1.7">
      <Flex align="center" justify="space-between" mb={1}>
        <Text color="accent.300" fontWeight="semibold">LLM context — what the AI write-up sees</Text>
        <Button
          size="xs"
          variant="outline"
          borderColor="borderC"
          height="22px"
          onClick={copyContext}
        >
          {ctxCopied ? "Copied ✓" : "Copy"}
        </Button>
      </Flex>
      <Text color="muted">
        {context.symbol ?? ""}
        {context.name ? ` — ${context.name}` : ""}
        {context.fy != null ? ` · FY ${context.fy}` : ""}
        {context.periodEnd ? ` · period ${context.periodEnd}` : ""}
        {context.units === "rial" ? " · values in rial" : ""}
      </Text>

      {context.lineItems.length ? (
        <Box mt={1} borderWidth="1px" borderColor="borderC" rounded="md" bg="bg" p={2}>
          {context.lineItems.map((li) => (
            <Flex key={`${li.fy}-${li.metric}`} justify="space-between" gap={3}>
              <Text truncate>{li.label}</Text>
              <Text color="muted">
                {li.value.toLocaleString("en-US")} <Text as="span" color="borderC">ریال · FY {li.fy}</Text>
              </Text>
            </Flex>
          ))}
        </Box>
      ) : null}

      {context.statement ? (
        <details>
          <summary style={{ cursor: "pointer", marginTop: "6px" }}>
            Statement — {context.statement.title} {context.statement.periodEnd ? `(${context.statement.periodEnd})` : ""}
          </summary>
          <Box mt={1}>
            {context.statement.keyPoints?.length ? (
              <>
                <Text color="accent.300" fontWeight="semibold">Key points</Text>
                {context.statement.keyPoints.map((kp, i) => (
                  <Text key={i} color="muted">• {kp}</Text>
                ))}
              </>
            ) : null}
            <Text mt={1} color="muted" whiteSpace="pre-wrap" maxH="200px" overflowY="auto">
              {context.statement.excerpt || "(no narrative text stored — gather data to re-download the PDF)"}
            </Text>
          </Box>
        </details>
      ) : null}

      {context.reports.map((r) => (
        <details key={`${r.kind}-${r.title}`}>
          <summary style={{ cursor: "pointer", marginTop: "6px" }}>
            {kindLabel(r.kind)} — {r.title} {r.published ? `(${r.published})` : ""}
          </summary>
          <Box mt={1}>
            {r.keyPoints?.length ? (
              <>
                <Text color="accent.300" fontWeight="semibold">Key points</Text>
                {r.keyPoints.map((kp, i) => (
                  <Text key={i} color="muted">• {kp}</Text>
                ))}
              </>
            ) : null}
            <Text mt={1} color="muted" whiteSpace="pre-wrap" maxH="200px" overflowY="auto">
              {r.excerpt || "(no text)"}
            </Text>
          </Box>
        </details>
      ))}
    </Box>
  );
}

function kindLabel(kind: string): string {
  switch (kind) {
    case "interpretive": return "گزارش تفسیری";
    case "board": return "گزارش هیئت مدیره";
    case "forecast": return "پیش‌بینی سود";
    case "disclosure": return "افشای اطلاعات با اهمیت";
    default: return kind || "report";
  }
}

/** Format a rial amount with thousand separators, or a short label for large amounts. */
function fmtRial(v: number | undefined | null): string {
  if (v == null || !isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${(v / 1e12).toFixed(2)}T ریال`;
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B ریال`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M ریال`;
  return v.toLocaleString("en-US") + " ریال";
}

/** Format an assumption value with its unit. */
function fmtVal(v: number, unit: string): string {
  if (unit === "%" || unit === "ratio") return `${(v * 100).toFixed(1)}%`;
  if (unit === "pp") return `${(v * 100).toFixed(1)}pp`;
  if (unit === "x") return `${v.toFixed(1)}x`;
  if (unit === "0-1") return v.toFixed(2);
  if (unit === "factor") return `${v.toFixed(2)}x`;
  return `${v}`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Box minW="120px" p={3} borderWidth="1px" borderColor="borderC" rounded="md" bg="bg">
      <Text fontSize="xs" color="muted">{label}</Text>
      <Text fontSize="sm" fontWeight="semibold" fontFamily="mono">{value}</Text>
    </Box>
  );
}

/** Parses the app's SSE (data: {"delta":…} … {"done":true, "id":…}). Mirrors components/Chat.tsx. */
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
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
  const logRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    const r = await fetch("/api/market").then((r) => r.json()).catch(() => null);
    if (r && typeof r === "object") setStatus(r as Status);
  }, []);

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
    (cs ?? []).map((c) => `${c.name} = ${c.value.toFixed(3)}${c.unit ? ` ${c.unit}` : ""}`).join("\n");

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
        push("ok", `✔ EOD sync: ${data.succeeded}/${data.total} instruments synced`);
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
          <Heading size="lg">Sync &amp; Education Center</Heading>
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
          <TabsTrigger value="sync">Sync</TabsTrigger>
          <TabsTrigger value="education">Education</TabsTrigger>
        </TabsList>

        {/* ---------------- SYNC ---------------- */}
        <TabsContent value="sync">
          <VStack align="stretch" spaceY={6}>
            {/* Actions */}
            <Box p={4} borderWidth="1px" borderColor="borderC" rounded="md" bg="surface">
              <Heading size="sm" mb={3}>Sync actions</Heading>
              <Flex gap={2} wrap="wrap" align="center">
                <Input
                  placeholder="Symbol or insCode (e.g. فولاد)"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && symbol.trim() && runSync({ action: "sync", symbol: symbol.trim() }, `sync ${symbol.trim()}`)}
                  bg="bg"
                  borderColor="borderC"
                  maxW="260px"
                />
                <Button
                  colorScheme="accent"
                  size="sm"
                  disabled={!symbol.trim() || !!busy}
                  onClick={() => symbol.trim() && runSync({ action: "sync", symbol: symbol.trim() }, `sync ${symbol.trim()}`)}
                >
                  Sync symbol
                </Button>
                <Button
                  variant="outline"
                  borderColor="borderC"
                  size="sm"
                  disabled={!!busy}
                  onClick={() => runSync({ action: "sync" }, "sync all instruments")}
                >
                  Sync all instruments
                </Button>
                <Button
                  variant="outline"
                  borderColor="borderC"
                  size="sm"
                  disabled={!!busy}
                  onClick={() => runSync({ action: "syncCodal", days: 30, limit: 40, download: true }, "sync recent Codal filings")}
                >
                  Sync recent Codal filings
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
                  <Button size="xs" variant="ghost" color="muted" onClick={() => refresh()}>
                    Refresh
                  </Button>
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
                  <Text fontSize="sm" color="muted">No instruments yet — sync one by symbol to start.</Text>
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
              <Heading size="sm" mb={1}>Analyze a synced symbol</Heading>
              <Text fontSize="xs" color="muted" mb={3}>
                Loads the stored bars + any parsed fundamentals for a symbol and runs the brain on them
                (technical: RSI/MACD/ADX/SMA… — available after any sync; fundamental: needs a parsed
                statement PDF in <code>fundamentals</code>).
              </Text>
              <Flex gap={2} wrap="wrap" align="center">
                <Input
                  placeholder="Symbol already synced (e.g. فولاد)"
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
                    <Text fontSize="xs" color="muted">AI write-up (synced data + statement context → synthesis LLM)</Text>
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
                        <Text key={c.name}>{c.name} = {c.value.toFixed(3)}</Text>
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
                        <Text key={c.name}>{c.name} = {c.value.toFixed(3)}</Text>
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
                {log.length === 0 && <Text color="muted">Nothing yet — run a sync to populate this.</Text>}
                {log.map((e) => (
                  <Text key={e.id} color={e.kind === "err" ? "red.300" : e.kind === "ok" ? "green.300" : "muted"}>
                    {e.text}
                  </Text>
                ))}
              </Box>
            </Box>
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
              <Heading size="sm" mb={2}>What happens after sync</Heading>
              <Text fontSize="sm" color="muted">
                Synced instruments become available to the chat pipeline: paste fundamental notes into a
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
type FReport = { kind: string; title: string; published: string | null; excerpt: string };
type FContext = {
  symbol: string | null;
  name: string | null;
  fy: number | null;
  periodEnd: string | null;
  lineItems: FLineItem[];
  statement: { title: string; periodEnd: string | null; excerpt: string } | null;
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
    parts.push(context.statement.excerpt || "(no narrative text stored — sync re-downloads the PDF)");
  }

  for (const r of context.reports) {
    parts.push(`${kindLabel(r.kind)} — ${r.title}${r.published ? ` (${r.published})` : ""}`);
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
          <Text mt={1} color="muted" whiteSpace="pre-wrap" maxH="200px" overflowY="auto">
            {context.statement.excerpt || "(no narrative text stored — sync re-downloads the PDF)"}
          </Text>
        </details>
      ) : null}

      {context.reports.map((r) => (
        <details key={`${r.kind}-${r.title}`}>
          <summary style={{ cursor: "pointer", marginTop: "6px" }}>
            {kindLabel(r.kind)} — {r.title} {r.published ? `(${r.published})` : ""}
          </summary>
          <Text mt={1} color="muted" whiteSpace="pre-wrap" maxH="200px" overflowY="auto">
            {r.excerpt || "(no text)"}
          </Text>
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
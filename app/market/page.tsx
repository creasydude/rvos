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
];

let logId = 0;

export default function MarketPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [symbol, setSymbol] = useState("");
  const [analyzeSymbol, setAnalyzeSymbol] = useState("");
  const [analysis, setAnalysis] = useState<Record<string, unknown> | null>(null);
  const [analysing, setAnalysing] = useState(false);
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
              (r.statements != null ? ` · ${r.statements} statements → ${r.fundamentalItems ?? 0} fundamental line items` : "")
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
              </Flex>

              {analysis && (
                <Box mt={4} fontSize="xs" fontFamily="mono" lineHeight="1.7">
                  <Text color="muted">
                    last close = {String(analysis.lastPrice)} · bars = {String(analysis.bars)}
                    {analysis.fiscalYear != null ? ` · fiscal year = ${String(analysis.fiscalYear)}` : " · no fundamentals parsed"}
                  </Text>
                  {(analysis.technical as { calcs: { name: string; value: number; unit?: string }[] })?.calcs?.length ? (
                    <Box mt={2}>
                      <Text color="accent.300" fontWeight="semibold" mb={1}>Technical calcs</Text>
                      {(analysis.technical as { calcs: { name: string; value: number; unit?: string }[] }).calcs.map((c) => (
                        <Text key={c.name}>{c.name} = {c.value.toFixed(3)}</Text>
                      ))}
                    </Box>
                  ) : null}
                  {(analysis.fundamental as { calcs: { name: string; value: number; unit?: string }[] })?.calcs?.length ? (
                    <Box mt={2}>
                      <Text color="accent.300" fontWeight="semibold" mb={1}>Fundamental calcs</Text>
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
<div align="center">

# 🧠 RVOS — Research Valuation Tool

**The LLM writes the thesis. The math is all TypeScript.**

RVOS turns raw Tehran Stock Exchange data into fully-quantified investment write-ups.
An LLM structures your input, a deterministic brain computes *every* number, and the
LLM weaves the results into a **bear / base / bull** narrative — zero hallucinated arithmetic.

[🇺🇸 English](README.md) · [🇮🇷 فارسی](README.fa.md)

![TypeScript](https://img.shields.io/badge/TypeScript-blue?style=for-the-badge&logo=typescript&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js%2016-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)
![React](https://img.shields.io/badge/React%2019-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![Node.js](https://img.shields.io/badge/Node.js%20%E2%89%A5%2022.5-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-node%3A%3Asqlite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)
![Chakra UI](https://img.shields.io/badge/Chakra%20UI-3-319795?style=for-the-badge&logo=chakraui&logoColor=white)
![Tehran Stock Exchange](https://img.shields.io/badge/Tehran%20Stock%20Exchange-1f6feb?style=for-the-badge)
![TSETMC](https://img.shields.io/badge/TSETMC-00a3e0?style=for-the-badge)
![Codal](https://img.shields.io/badge/Codal-8b5cf6?style=for-the-badge)
![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=for-the-badge)

</div>

---

## 🚀 What it does

RVOS is a **three-stage analysis pipeline**:

1. **Restructure** — paste raw fundamental / technical data. An LLM turns it into clean, structured notes.
2. **Compute** — a deterministic TypeScript brain computes every valuation multiple, growth metric, and technical indicator. The LLM **never** does arithmetic; every number comes from auditable functions in `brain/`.
3. **Synthesize** — the LLM reads the computed numbers and writes a bear / base / bull investment thesis you can actually debate.

## 📊 Built for the Tehran Stock Exchange

- **TSETMC sync** — pull OHLCV bars, price adjustments, share changes, client-type flows and quotes from `cdn.tsetmc.com`.
- **Codal fundamentals** — find, download and parse a company's annual financial statements (PDF/Excel) into a normalized metric store — including **loss-makers**, so no symbol shows up as "technical-only" by accident.
- **Jalali calendar awareness** — reporting periods are handled in the Persian calendar throughout.
- **Iran Stocks Data** — a dedicated UI at `/market` to gather data for any symbol, inspect stored rows, run the brain, and read plain-language explanations of every model.

## 🧮 The brain

| Fundamental (`brain/fundamental.ts`) | Technical (`brain/technical.ts`) |
| --- | --- |
| DCF (enterprise value + margin of safety) | Moving averages (SMA / EMA) |
| P/E, P/B, P/S (+ peer premium) | MACD (signal, histogram) |
| EV/EBITDA (+ peer premium) | RSI(14) with overbought/oversold |
| Graham Number & margin of safety | Bollinger Bands, Stochastic |
| DDM (Gordon) & margin of safety | ATR(14), ADX / +DI / −DI |
| DuPont ROE decomposition | OBV, VWAP, Z-score |
| Altman Z-Score | Trend slope, R², channels |
| Piotroski F-Score, FCF yield | |

Every skipped calc is explained — e.g. *"P/E skipped: EPS ≤ 0 (company is loss-making)"* — so the output is always interpretable, never silent.

## 🛠️ Quick start

> Requires **Node.js ≥ 22.5** (uses the built-in `node:sqlite` — no native modules).

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000):

1. Go to **Settings** (gear icon) → add an OpenAI-compatible endpoint → assign it to the three roles (**fundamental**, **technical**, **synthesis**).
2. Paste raw data into the chat and get a structured, computed write-up back.
3. Visit the **Iran Stocks Data** at `/market` to pull real market data first.

## 📡 Market data API

```bash
# Sync one symbol (technical + Codal fundamentals + parse)
curl -X POST http://localhost:3000/api/market \
  -H 'Content-Type: application/json' \
  -d '{"action":"sync","symbol":"فولاد"}'

# Batch sync all known instruments
curl -X POST http://localhost:3000/api/market \
  -H 'Content-Type: application/json' \
  -d '{"action":"sync"}'

# Recent Codal filings (also parses tracked statements into fundamentals)
curl -X POST http://localhost:3000/api/market \
  -H 'Content-Type: application/json' \
  -d '{"action":"syncCodal","days":30,"limit":40}'

# Analyze a synced symbol
curl "http://localhost:3000/api/market/analyze?symbol=%D9%81%D9%88%D9%84%D8%A7%D8%AF"
```

## 🗂️ Layout

| Path | Purpose |
| --- | --- |
| `brain/` | Pure TypeScript models — fundamental & technical calcs, self-test |
| `lib/market/` | Data engine — TSETMC/Codal clients, sync ETL, statement parser, Jalali calendar |
| `lib/` | LLM adapter (OpenAI-compatible + SSE), prompts, analyze orchestration, SQLite |
| `app/api/` | REST endpoints — chat, analyze, roles, endpoints, market sync |
| `app/market/` | Iran Stocks Data UI |
| `app/settings/` | Endpoint + role assignment UI |
| `scripts/` | Dev harnesses — mock LLM server, E2E smoke tests, sync verifier |

## 🧪 Testing

```bash
npm run brain:test                 # verifies all fundamental + technical math
node scripts/mock-llm.js           # local OpenAI-compatible SSE server (http://localhost:9999/v1)
npx tsx scripts/verify-fundamentals.ts فولاد   # end-to-end market sync + parse check
```

## ⚠️ Disclaimer

RVOS is a **research and education tool, not financial advice**. All outputs are estimates
and may contain errors — especially around edge-case filings. Do your own diligence.
API keys are stored locally in `data/app.db` (see the TODO in `lib/db.ts`).

---

<div align="center">

Made with ❤️ for the Iranian market — [🇮🇷 نسخهٔ فارسی](README.fa.md)

</div>

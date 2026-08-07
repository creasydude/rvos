# Research Valuation Tool

Three-stage analysis pipeline: pasted fundamental/technical data → LLM restructures into notes → deterministic brain computes → LLM writes a bear/base/bull write-up.

**Research tool, not financial advice.** All outputs are estimates; the LLM never does arithmetic — every number is computed by TypeScript functions in `brain/`.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`, go to **Settings** (gear icon), add an endpoint and assign it to the three roles, then paste data in the chat.

## Brain self-test

```bash
npm run brain:test   # verifies fundamental + technical math
```

## Layout

- `brain/fundamental.ts` — DCF, multiples, Graham, DDM, DuPont, Altman Z, Piotroski F, FCF yield (pure TS)
- `brain/technical.ts` — SMA/EMA, MACD, RSI, Bollinger, Stochastic, ATR, ADX, OBV, VWAP, Z-score, trend channels (over `technicalindicators`)
- `lib/` — LLM adapter (single OpenAI-compatible core + SSE), prompts, analyze orchestration, SQLite storage (`node:sqlite`)
- `app/api/` — endpoints, roles, extract, streaming analyze, analyses history
- `app/settings/` — endpoint + role assignment UI

## Persistence

SQLite in `data/app.db`, server-side only. API keys are stored plaintext (see TODO in `lib/db.ts`).

## Dev extras

- `scripts/mock-llm.js` — tiny OpenAI-compatible SSE server for local testing (`node scripts/mock-llm.js`, baseUrl `http://localhost:9999/v1`)
- `scripts/e2e-analyze.mjs` — streaming analyze smoke test
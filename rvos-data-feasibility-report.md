# RVOS Data Integration — Research & Feasibility Report

**Date:** 2026-08-07 · **Status: GO** (all four hard gates satisfiable)
**Scope:** Codal.ir (fundamentals) + TSETMC (technicals) → RVOS brain. Research only; no implementation code written.

---

## 1. Executive summary

Both sources are reachable, anonymous, JSON/structured, and free of observed rate limits — **from an Iranian egress**. Technical data is a slam dunk: TSETMC's `cdn.tsetmc.com` JSON API returns clean daily OHLCV (JSON + universal CSV), corporate-action adjustments, share-count changes, and retail-vs-institutional flow history. Fundamental data exists but the numbers live **inside PDF attachments** — the search API exposes rich metadata and anonymous PDF downloads, but a **PDF→table parsing step** is required to turn filings into the EPS / revenue / balance-sheet time series the brain's models consume.

## 2. Source inventory (verified live)

### 2.1 TSETMC — `cdn.tsetmc.com/api/...`

| Endpoint | Purpose | Notes |
|---|---|---|
| `Instrument/GetInstrumentSearch/{text}` | Universe discovery | Returns `insCode`, symbol, ISIN, market |
| `Instrument/GetInstrumentInfo/{insCode}` | Real-time quote + quick ratios | `estimatedEPS`, `sectorPE`, `psr`, shares out, price bounds |
| `ClosingPrice/GetClosingPriceDailyList/{insCode}/{n}` | **Daily OHLCV JSON** | Per day: open=`priceFirst`, high=`priceMax`, low=`priceMin`, close=`pClosing`, last=`pDrCotVal`, vol=`zTotTran`, value=`qTotCap`, trades=`qTotTran5J`, date `dEven` (YYYYMMDD) |
| `ClosingPrice/GetClosingPriceDailyListCSV/{insCode}/{n}` | Daily OHLCV CSV | Universal `<TICKER>,<DTYYYYMMDD>,<FIRST>,<HIGH>,<LOW>,<CLOSE>,<VALUE>,<VOL>,<OPENINT>,<PER>,<OPEN>,<LAST>` |
| `ClosingPrice/GetPriceAdjustList/{insCode}` | Corporate-action events | adjusted vs unadjusted close per event date |
| `Instrument/GetInstrumentShareChange/{insCode}` | Share-count history | capital increases / bonus shares |
| `ClientType/GetClientTypeHistory/{insCode}` | Retail vs institutional flows | daily buy/sell volume+value, counts |
| `Trade/GetTradeIntraDay/{insCode}` | Intraday trades | populates during market hours |
| `BestLimits/GetBestLimitsTop/{flow}/{insCode}/{top}` | Order book | **amber:** flaky under direct probing, needs header/signature tuning |
| `Codal/GetPreparedDataByInsCode/{ic}/{t}` | Structured statements (proxy) | **empty in testing** — do not rely on |

- **Verified depth:** 4,613 daily bars per symbol in one call (2007→2026). Adjustments back to 2021, share changes back to 2015.
- **Access:** no auth, no CAPTCHA, 20-request burst → 20/20 HTTP 200.
- **Deprecated:** legacy `old.tsetmc.com` MarketWatch/instinfodata → 403/303. Use cdn JSON.

### 2.2 Codal — `search.codal.ir/api/search/v2/q`

- Anonymous JSON; params incl. Persian-date window (`FromDate`/`ToDate`), `LetterType`, `CorporateIdentifier`, text search, pagination.
- Letter object: `Symbol`, `CompanyName`, `LetterCode` (standard form, e.g. `ن-۱۰` = financial statements), Persian publish timestamps, `HasPdf/HasExcel/HasHtml/HasXbrl`, `Url`, `AttachmentUrl`, `PdfUrl`, `ExcelUrl`.
- **Key limitation:** search response is **metadata only** — no numeric line items. Numbers live in attachments.
- **Attachment paths verified:** `DownloadFile.aspx?hs=<hash>&ft=1005&let=6` → real PDF, anonymous (HTTP 200, application/pdf). `excel.codal.ir/service/Excel/GetAll/<serial>/0` → old MSO-HTML workbook (not binary XLSX). `Attachment.aspx` → ASP.NET WebForms (session/VIEWSTATE needed for sub-attachments). `Decision.aspx` HTML render → narrative (auditor text), not numeric tables.
- **Access:** no auth, no burst limit observed.

### 2.3 Hosting requirement

**Backend must run from an Iranian egress** (Iranian VPS or domestic proxy). This sandbox's egress is an Iranian IP, so all probes behaved like a domestic client and both sites worked. Behavior from foreign IPs is untested and known to be worse (TSETMC legacy endpoints 403'd even on some routes). An Iranian VPS removes this whole risk class.

## 3. Model-contract mapping (what the pipeline must guarantee)

RVOS `brain/` consumes exactly these inputs (`brain/types.ts`, `lib/analyze.ts`). Mapping each to a source:

| Brain input | Models that need it | Source | Extraction |
|---|---|---|---|
| `close/high/low/open/volume` arrays | All technical (SMA/EMA/MACD/RSI/BB/Stoch/ATR/ADX/OBV/VWAP/Z-score/trend/SR) | TSETMC `GetClosingPriceDailyList` | clean equal-length arrays; **store raw + adjusted** |
| `price` (last) | P/E, P/B, P/S, Graham, DDM, DCF, Z-score | TSETMC `GetInstrumentInfo` or last daily close | quote snapshot |
| `sharesOutstanding` | market cap, DCF/share, F-Score #7 | TSETMC `GetInstrumentInfo` + `GetInstrumentShareChange` history | **time-varying** — shares change over years |
| `eps`, `revenue`, `cogs`, `netIncome`, `ebitda`, `ebit`, `preTaxIncome`, `taxExpense`, `interestExpense`, `operatingCashFlow`, `fcf`, `capex`, `totalAssets`, `totalLiabilities`, `shareholdersEquity`, `totalDebt`, `currentAssets`, `currentLiabilities`, `retainedEarnings`, `bookValuePerShare`, `salesPerShare` | P/E, EV/EBITDA, P/B, P/S, Graham, DuPont ROE, Altman Z, FCF yield, F-Score | Codal financial statements | **PDF→table parsing** (annual + interim) |
| `dividendsPerShare`, `payoutRatio`, `growthRate` | DDM (Gordon) | Codal dividend letters + TSETMC `GetPriceAdjustList` | per-period DPS |
| `pePeer`, `evEbitdaPeer`, `pbPeer`, `psPeer` | Peer-premium calcs | TSETMC `sectorPE` / sector aggregates | auto-fill vs user-supplied (open Q4) |
| `priorYear.{...}` | Piotroski F-Score | Codal prior-year statements | needs ≥2 statement periods |
| `fcfProjection`, `discountRate`, `terminalGrowthRate`, `fcfGrowthRate`, `beta` | DCF, misc | user input / assumed | **not** from data sources |

Not in the brain today but available for future risk/flow models: `ClientTypeHistory`, `ShareChange`, intraday trades.

## 4. Recommended architecture (EOD batch baseline)

- **Core:** daily EOD ETL (~17:30 Tehran, after publish lag) fetching per-symbol daily bars, price adjustments, share changes, client flows, and a quote snapshot → upsert into SQLite (idempotent, keyed on `(insCode, dEven)`).
- **Light additions (cheap, no rate limits):** 5-min quote poll for the watchlist; 15–30-min Codal watch during market hours to detect new filings and re-score affected symbols.
- **Storage:** extend the app's existing `node:sqlite` as system of record — the full universe (~700 symbols × ~4,600 bars) is only a few million rows. No TSDB / document store needed. Tables: `instruments`, `daily_bars`, `price_adjustments`, `share_changes`, `client_flows`, `quotes_snapshot`, `codal_letters`, `filings_index` (serial → PDF paths on disk), `statement_line_items` (period, item, value).
- **Parsing microservice:** discrete module for Codal PDF→table extraction (standard forms like `ن-۱۰` are extractable without OCR; funds are messier). Quick ratios (`estimatedEPS`, `sectorPE`) come free from TSETMC while parsing lags.
- **Scheduling:** app-level scheduler (runs while the app is open — acceptable for a research tool) or OS Task Scheduler for headless reliability.

## 5. Build options into RVOS

1. **Option A — In-app ETL worker (recommended).** Next.js route(s) + `node:sqlite` + the app's scheduler. Simplest; matches the stack; single process; brain reads directly from the same DB.
2. **Option B — Standalone worker.** Separate process writes the shared SQLite file; app only reads. Cleaner separation and easier to run headless, but needs a second runner and version-locking on the DB schema.
3. **Option C — Two-tier analytic store.** Ingest → DuckDB/Parquet, app queries on demand. Overkill for this scale; only revisit if the models grow heavy cross-sectional scans.

## 6. Risks & open items

- Iranian-egress requirement (unverified from foreign IPs) — host on Iranian VPS.
- Order-book endpoint (`GetBestLimitsTop`) flaky — tune headers/signature or rely on intraday trades.
- Codal `LetterType` taxonomy needs a one-time mapping (only type 6 / financial statements confirmed so far).
- Statement parsing variance: annual vs interim periods, fund vs corporate statements.
- Adjusted-series construction is ours to build (raw closes + adjustment events).
- Peer multiples: single `sectorPE` aggregate may be too coarse for peer premiums.
- Publish timing drift (TSETMC EOD publish lag; Codal async) — schedule with buffer + retry.

## 7. Open questions for the RVOS models (asked via chat)

Q1. Adjusted vs raw prices for technical inputs. Q2. Fundamentals period alignment (annual-only / TTM / annualized interim). Q3. F-Score prior-year depth. Q4. Peer-multiple sourcing (TSETMC auto vs user-supplied).

---

## 8. Decisions locked (model-driven spec, 2026-08-07)

1. **Price basis:** store both raw and adjusted closes; brain defaults to **raw** traded closes, adjusted series available to trend/backtest models.
2. **Fundamental periods:** present the **latest audited annual statement** as the canonical figure set; interim reports retained as source data but not used for the brain's single-period models.
3. **History depth:** parse **two fiscal years** (current + prior) for F-Score; scale up only if trend models ask.
4. **Peer ratios:** **hybrid** — auto-fill `pePeer`/`evEbitdaPeer`/`pbPeer`/`psPeer` from TSETMC sector aggregates, with user override.

Together with §3, this fully specifies the ingest contract: TSETMC for technicals (raw+adjusted), flows, corporate actions, shares, and quick ratios; Codal parsed statements (2 annual periods) for line-items; hybrid peer fill.

*Appendix: raw probe evidence (IP egress, endpoint responses, depth counts) captured in the session transcript and in project memory.*

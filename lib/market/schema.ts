// Market-data schema (Option A — EOD batch ETL into the app's SQLite).
// Idempotent: CREATE TABLE IF NOT EXISTS, safe to run on every request.
// Tables store raw normalized rows from TSETMC + Codal; the brain loaders in
// lib/market/load.ts read these back into the brain's input shapes.

import { db } from "@/lib/db";

let initialized = false;

export function ensureMarketSchema(): void {
  if (initialized) return;
  db.exec(`
CREATE TABLE IF NOT EXISTS instruments (
  ins_code TEXT PRIMARY KEY,
  symbol TEXT,                -- Persian ticker (lVal18AFC) — join key to Codal letters
  name TEXT,                  -- lVal30
  lval18 TEXT,
  c_isin TEXT,
  market TEXT,                -- flowTitle e.g. بازار بورس
  sector TEXT,                -- lSecVal e.g. فلزات اساسی
  sector_code TEXT,
  shares_outstanding REAL,
  base_vol INTEGER,
  est_eps REAL,
  sector_pe REAL,
  psr REAL,
  last_price REAL,
  open REAL,
  price_min REAL,
  price_max REAL,
  flow INTEGER,
  updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_instruments_symbol ON instruments(symbol);

CREATE TABLE IF NOT EXISTS daily_bars (
  ins_code TEXT NOT NULL,
  d_even INTEGER NOT NULL,     -- YYYYMMDD (Gregorian, trading date)
  h_even INTEGER,              -- HHMMSS
  open REAL, high REAL, low REAL, close REAL, last REAL,
  price_change REAL,
  volume REAL,                 -- zTotTran traded shares
  value REAL,                  -- qTotCap traded value
  trades REAL,                 -- qTotTran5J number of trades
  PRIMARY KEY (ins_code, d_even)
);

CREATE TABLE IF NOT EXISTS price_adjustments (
  ins_code TEXT NOT NULL,
  d_even INTEGER NOT NULL,
  p_closing REAL,              -- adjusted close
  p_closing_not_adjusted REAL,
  PRIMARY KEY (ins_code, d_even)
);

CREATE TABLE IF NOT EXISTS share_changes (
  ins_code TEXT NOT NULL,
  d_even INTEGER NOT NULL,
  new_shares REAL,
  old_shares REAL,
  PRIMARY KEY (ins_code, d_even)
);

CREATE TABLE IF NOT EXISTS client_flows (
  ins_code TEXT NOT NULL,
  rec_date INTEGER NOT NULL,   -- YYYYMMDD
  buy_i_vol REAL, buy_n_vol REAL,
  buy_i_val REAL, buy_n_val REAL,
  buy_i_count REAL, buy_n_count REAL,
  sell_i_vol REAL, sell_n_vol REAL,
  sell_i_val REAL, sell_n_val REAL,
  sell_i_count REAL, sell_n_count REAL,
  PRIMARY KEY (ins_code, rec_date)
);

CREATE TABLE IF NOT EXISTS quotes_snapshot (
  ins_code TEXT PRIMARY KEY,
  last REAL, open REAL, high REAL, low REAL,
  volume REAL, value REAL, trades REAL,
  price_change REAL,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS codal_letters (
  tracing_no INTEGER PRIMARY KEY,
  symbol TEXT,
  company_name TEXT,
  letter_code TEXT,            -- standard form, e.g. ن-۱۰
  title TEXT,
  letter_type INTEGER,
  sent_at TEXT,                -- Persian datetime as published (e.g. ۱۴۰۵/۰۴/۲۳)
  published_at INTEGER,        -- epoch ms (best-effort conversion)
  has_pdf INTEGER, has_excel INTEGER, has_html INTEGER, has_xbrl INTEGER,
  serial TEXT,                 -- LetterSerial (URL-encoded)
  url TEXT,
  fetched_at INTEGER
);

CREATE TABLE IF NOT EXISTS statement_docs (
  tracing_no INTEGER PRIMARY KEY,
  ins_code TEXT,
  symbol TEXT,
  letter_code TEXT,
  title TEXT,
  period_end TEXT,             -- normalized Persian date e.g. 1404/12/29
  fy INTEGER,                  -- Jalali fiscal year of period_end
  pdf_path TEXT,
  raw_text TEXT,
  parsed_at INTEGER
);

-- Parsed statement line items: one row per (ins_code, fiscal year, metric).
-- metric keys use a fixed vocabulary (see lib/market/metrics.ts).
CREATE TABLE IF NOT EXISTS fundamentals (
  ins_code TEXT NOT NULL,
  fy INTEGER NOT NULL,
  metric TEXT NOT NULL,
  value REAL,
  updated_at INTEGER,
  PRIMARY KEY (ins_code, fy, metric)
);
`);
  // Migrate: add excel_url column if missing (safe to call repeatedly)
  try { db.exec("ALTER TABLE statement_docs ADD COLUMN excel_url TEXT"); } catch { /* already exists */ }
  initialized = true;
}

import { DatabaseSync } from "node:sqlite";
import fs from "fs";
import path from "path";

// Server-side only. Key/value stores via SQLite — the storage layer is a
// serialization detail; roles, analyses, endpoints and chat messages are just
// typed maps.
//
// TODO(phase 1): encrypt api_key at rest. Plain for now — single local user.
//
// Storage engine: node:sqlite (Node's built-in SQLite), NOT better-sqlite3.
// better-sqlite3 is a native module that must be compiled from source when no
// prebuilt binary exists for the runtime ABI (Node 26 has no prebuilds yet),
// which required a Windows C++ toolchain. node:sqlite ships inside Node, so
// there is nothing to install or compile. The .db file format is identical.

// Overridable so tests/sandbox runs use a throwaway store instead of the live
// app's data/. The app itself leaves it defaulted to cwd/data.
const DATA_DIR = process.env.RVOS_DATA_DIR || path.join(process.cwd(), "data");
// data/ is a direct child of cwd, so a plain mkdirSync is enough (the
// recursive option isn't in this @types/node's overloads). The inline
// turbopackIgnore keeps Turbopack from tracing the whole project for this
// env-derived runtime path (RVOS_DATA_DIR or cwd/data).
if (!fs.existsSync(/* turbopackIgnore: true */ DATA_DIR)) fs.mkdirSync(DATA_DIR);

let _db: DatabaseSync | undefined;

/**
 * Lazy singleton. Opening at module load breaks `next build` (its page-data
 * workers all import route modules concurrently → SQLITE_BUSY). Open on first
 * real request instead; a busy timeout swallows transient contention.
 */
function getDb(): DatabaseSync {
  if (!_db) {
    _db = new DatabaseSync(path.join(DATA_DIR, "app.db"));
    // PRAGMAs go through exec() — node:sqlite has no .pragma() method.
    _db.exec("PRAGMA busy_timeout = 5000");
    _db.exec("PRAGMA journal_mode = WAL");
    _db.exec(`
  CREATE TABLE IF NOT EXISTS endpoints (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    base_url TEXT,
    api_key TEXT NOT NULL,
    model TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS roles (
    role TEXT PRIMARY KEY,       -- 'fundamental' | 'technical' | 'synthesis'
    endpoint_id TEXT REFERENCES endpoints(id)
  );
  CREATE TABLE IF NOT EXISTS analyses (
    id TEXT PRIMARY KEY,
    ticker TEXT,
    title TEXT,
    kind TEXT NOT NULL,          -- 'notes' | 'analysis'
    body TEXT NOT NULL,
    fundamental TEXT,            -- serialized fundamental notes (JSON)
    technical TEXT,              -- serialized technical notes (JSON)
    brain TEXT,                  -- rendered brain calcs (the numbers the chat may cite)
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
    role TEXT NOT NULL,          -- 'user' | 'assistant'
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_chat_messages_analysis
    ON chat_messages (analysis_id, created_at);
`);
    // Migration: analyses created before the context columns existed lack
    // fundamental/technical/brain. SQLite has no ADD COLUMN IF NOT EXISTS, so
    // introspect PRAGMA table_info and add whatever is missing.
    const cols = (_db.prepare("PRAGMA table_info(analyses)").all() as any[]).map((c) => c.name);
    for (const col of ["fundamental", "technical", "brain"]) {
      if (!cols.includes(col)) _db.exec(`ALTER TABLE analyses ADD COLUMN ${col} TEXT`);
    }
  }
  return _db;
}

/**
 * Proxy so the rest of the file can keep calling `db.prepare(...)` etc. while
 * the real connection is created lazily on first use.
 */
export const db = new Proxy({} as DatabaseSync, {
  get(_t, prop) {
    const real = getDb();
    // Bind functions to the real connection — otherwise `this` inside the
    // method is the proxy, and node:sqlite methods throw "Illegal invocation".
    const value = Reflect.get(real, prop);
    return typeof value === "function" ? (value as Function).bind(real) : value;
  },
});

export type Endpoint = {
  id: string;
  name: string;
  provider: string;
  baseUrl?: string;
  apiKey: string;
  model: string;
};

export type RoleKey = "fundamental" | "technical" | "synthesis";

export function listEndpoints(): Omit<Endpoint, "apiKey">[] {
  return (db
    .prepare("SELECT id, name, provider, base_url, model FROM endpoints ORDER BY created_at DESC")
    .all() as any[]).map((r) => ({
    id: r.id,
    name: r.name,
    provider: r.provider,
    baseUrl: r.base_url ?? undefined,
    model: r.model,
  }));
}

export function getEndpoint(id: string): Endpoint | undefined {
  const r = db.prepare("SELECT * FROM endpoints WHERE id = ?").get(id) as any;
  if (!r) return undefined;
  return { id: r.id, name: r.name, provider: r.provider, baseUrl: r.base_url ?? undefined, apiKey: r.api_key, model: r.model };
}

export function saveEndpoint(e: Endpoint) {
  db.prepare(
    `INSERT INTO endpoints (id, name, provider, base_url, api_key, model, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, provider=excluded.provider, base_url=excluded.base_url,
       api_key=excluded.api_key, model=excluded.model`,
  ).run(e.id, e.name, e.provider, e.baseUrl ?? null, e.apiKey, e.model, Date.now());
}

export function deleteEndpoint(id: string) {
  // Clear role references first (FK constraint would block the endpoint delete).
  db.prepare("DELETE FROM roles WHERE endpoint_id = ?").run(id);
  db.prepare("DELETE FROM endpoints WHERE id = ?").run(id);
}

export function getRoleAssignments(): Record<RoleKey, string | null> {
  const out: Record<RoleKey, string | null> = { fundamental: null, technical: null, synthesis: null };
  for (const r of db.prepare("SELECT role, endpoint_id FROM roles").all() as any[]) {
    out[r.role as RoleKey] = r.endpoint_id;
  }
  return out;
}

export function setRole(role: RoleKey, endpointId: string | null) {
  if (endpointId === null) {
    db.prepare("DELETE FROM roles WHERE role = ?").run(role);
  } else {
    db.prepare(
      "INSERT INTO roles (role, endpoint_id) VALUES (?, ?) ON CONFLICT(role) DO UPDATE SET endpoint_id=excluded.endpoint_id",
    ).run(role, endpointId);
  }
}

export type Analysis = {
  id: string;
  ticker?: string;
  title?: string;
  kind: "notes" | "analysis";
  body: string;
  /** Serialized fundamental notes JSON — the raw stock data the chat can cite. */
  fundamental?: string;
  /** Serialized technical notes JSON. */
  technical?: string;
  /** Rendered brain calcs — the computed numbers the chat may reference. */
  brain?: string;
  createdAt: number;
};

export function listAnalyses(kind?: "notes" | "analysis"): Analysis[] {
  const rows = kind
    ? db.prepare("SELECT * FROM analyses WHERE kind = ? ORDER BY created_at DESC").all(kind)
    : db.prepare("SELECT * FROM analyses ORDER BY created_at DESC").all();
  return (rows as any[]).map(toAnalysis);
}

export function getAnalysis(id: string): Analysis | undefined {
  const r = db.prepare("SELECT * FROM analyses WHERE id = ?").get(id) as any;
  return r ? toAnalysis(r) : undefined;
}

export function deleteAnalysis(id: string) {
  db.prepare("DELETE FROM analyses WHERE id = ?").run(id);
}

export function saveAnalysis(a: Analysis) {
  db.prepare(
    `INSERT INTO analyses (id, ticker, title, kind, body, fundamental, technical, brain, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       ticker=excluded.ticker, title=excluded.title, kind=excluded.kind,
       body=excluded.body, fundamental=excluded.fundamental, technical=excluded.technical,
       brain=excluded.brain`,
  ).run(
    a.id,
    a.ticker ?? null,
    a.title ?? null,
    a.kind,
    a.body,
    a.fundamental ?? null,
    a.technical ?? null,
    a.brain ?? null,
    a.createdAt,
  );
}

function toAnalysis(r: any): Analysis {
  return {
    id: r.id,
    ticker: r.ticker ?? undefined,
    title: r.title ?? undefined,
    kind: r.kind,
    body: r.body,
    fundamental: r.fundamental ?? undefined,
    technical: r.technical ?? undefined,
    brain: r.brain ?? undefined,
    createdAt: r.created_at,
  };
}

export type ChatMessage = {
  id: string;
  analysisId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
};

export function listChatMessages(analysisId: string, limit = 50): ChatMessage[] {
  const rows = db
    .prepare("SELECT * FROM chat_messages WHERE analysis_id = ? ORDER BY created_at ASC, rowid ASC LIMIT ?")
    .all(analysisId, limit) as any[];
  return rows.map((r) => ({
    id: r.id,
    analysisId: r.analysis_id,
    role: r.role as ChatMessage["role"],
    content: r.content,
    createdAt: r.created_at,
  }));
}

export function saveChatMessage(m: ChatMessage) {
  db.prepare(
    "INSERT INTO chat_messages (id, analysis_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(m.id, m.analysisId, m.role, m.content, m.createdAt);
}

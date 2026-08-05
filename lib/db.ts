import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

// Server-side only. Key/value stores via SQLite — the storage layer is a
// serialization detail; roles, analyses and endpoints are just typed maps.
//
// TODO(phase 1): encrypt api_key at rest. Plain for now — single local user.

const DATA_DIR = path.join(process.cwd(), "data");
// data/ is a direct child of cwd, so a plain mkdirSync is enough (the
// recursive option isn't in this @types/node's overloads).
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

let _db: Database.Database | undefined;

/**
 * Lazy singleton. Opening at module load breaks `next build` (its page-data
 * workers all import route modules concurrently → SQLITE_BUSY). Open on first
 * real request instead; a busy timeout swallows transient contention.
 */
function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(path.join(DATA_DIR, "app.db"));
    _db.pragma("busy_timeout = 5000");
    _db.pragma("journal_mode = WAL");
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
    created_at INTEGER NOT NULL
  );
`);
  }
  return _db;
}

/**
 * Proxy so the rest of the file can keep calling `db.prepare(...)` etc. while
 * the real connection is created lazily on first use.
 */
const db = new Proxy({} as Database.Database, {
  get(_t, prop, receiver) {
    const real = getDb();
    return Reflect.get(real, prop, receiver);
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
     VALUES (@id, @name, @provider, @base_url, @api_key, @model, @created_at)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, provider=excluded.provider, base_url=excluded.base_url,
       api_key=excluded.api_key, model=excluded.model`,
  ).run({
    id: e.id,
    name: e.name,
    provider: e.provider,
    base_url: e.baseUrl ?? null,
    api_key: e.apiKey,
    model: e.model,
    created_at: Date.now(),
  });
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
    `INSERT INTO analyses (id, ticker, title, kind, body, created_at)
     VALUES (@id, @ticker, @title, @kind, @body, @created_at)
     ON CONFLICT(id) DO UPDATE SET body=excluded.body`,
  ).run({
    id: a.id,
    ticker: a.ticker ?? null,
    title: a.title ?? null,
    kind: a.kind,
    body: a.body,
    created_at: a.createdAt,
  });
}

function toAnalysis(r: any): Analysis {
  return { id: r.id, ticker: r.ticker ?? undefined, title: r.title ?? undefined, kind: r.kind, body: r.body, createdAt: r.created_at };
}

/**
 * Ambient types for Node's built-in `node:sqlite` module.
 *
 * The project's resolved `@types/node` (6.14.x, pinned by transitive deps)
 * predates node:sqlite and has no declaration for it, so `import { DatabaseSync }
 * from "node:sqlite"` would fail `tsc`. node:sqlite ships inside Node itself
 * (runtime needs no install); this file just tells TypeScript what lib/db.ts
 * actually uses. The types are deliberately narrow — anything outside that
 * surface is left `unknown`/`any` rather than invented.
 *
 * There's a readable declaration bundled with Node that would say the rest; if
 * @types/node is later upgraded to one that declares node:sqlite, this ambient
 * module may end up redundant — remove it then.
 */
declare module "node:sqlite" {
  type SQLValue = string | number | bigint | null | Uint8Array;

  interface StatementSync {
    run(...params: SQLValue[]): { changes: number | bigint; lastInsertRowid?: number | bigint };
    get(...params: SQLValue[]): unknown;
    all(...params: SQLValue[]): unknown[];
    iterate(...params: SQLValue[]): IterableIterator<unknown>;
  }

  interface DatabaseSync {
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }

  const DatabaseSync: {
    new (path?: string | Buffer, options?: { open?: boolean }): DatabaseSync;
    (path?: string | Buffer, options?: { open?: boolean }): DatabaseSync;
  };

  export { DatabaseSync };
}
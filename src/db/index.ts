import { Database } from "bun:sqlite";
import { resolve } from "node:path";
import { initSchema } from "./schema";
import { seedIfEmpty } from "./seed";

/**
 * Resolve the on-disk location of store.sqlite.
 *
 * The path is anchored to the project root (two levels up from this file:
 * src/db -> src -> root) rather than process.cwd(), so the database lands in
 * the workspace root no matter where `bun` is launched from. Tests and other
 * callers can override this with the DB_PATH env var (e.g. ":memory:" or a
 * temp file) to avoid touching the real store.sqlite.
 */
function resolveDbPath(): string {
  const override = process.env.DB_PATH;
  if (override && override.length > 0) return override;
  return resolve(import.meta.dir, "..", "..", "store.sqlite");
}

/**
 * Open a bun:sqlite database with sane pragmas.
 *
 * - WAL journaling gives better read/write concurrency for the API process.
 *   It is skipped for ":memory:" where WAL is meaningless.
 * - foreign_keys = ON enforces the REFERENCES constraints declared in the
 *   schema (SQLite leaves them off by default).
 */
export function openDb(path: string = resolveDbPath()): Database {
  const db = new Database(path, { create: true });
  if (path !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL;");
  }
  db.exec("PRAGMA foreign_keys = ON;");
  return db;
}

/**
 * Create the schema and seed the catalogue if empty. Both operations are
 * idempotent, so calling this on every boot is safe: the first run creates
 * and populates store.sqlite, later runs are no-ops.
 */
export function initDb(database: Database = db): Database {
  initSchema(database);
  seedIfEmpty(database);
  return database;
}

/**
 * The shared singleton connection used by the API route modules. Opening it
 * at import time means the first `import { db }` wires up the schema+seed via
 * initDb() in server.ts before the server starts serving requests.
 */
export const db: Database = openDb();

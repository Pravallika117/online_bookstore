import { SQL } from "bun";
import { initSchema } from "./schema";
import { seedIfEmpty } from "./seed";

/**
 * PostgreSQL connection module, backed by Bun's built-in SQL client
 * (`import { SQL } from "bun"`). No external driver, ORM, or Node tooling is
 * involved: Bun ships a complete Promise-based Postgres client (tagged
 * templates, pooling, transactions, RETURNING).
 *
 * All credentials live here and nowhere else. The app connects via the
 * DATABASE_URL environment variable; when it is unset the documented default
 * below is used. Tests may override the target with TEST_DATABASE_URL so they
 * never have to touch the primary connection string.
 *
 * Money convention is unchanged by this layer: every *_cents column is an
 * INTEGER number of paise (1 INR = 100 paise).
 */

/** The documented default connection string used when DATABASE_URL is unset. */
export const DEFAULT_DATABASE_URL =
  "postgres://postgres:password@localhost:5432/booksonline";

/**
 * Resolve the connection string for the primary (application) connection.
 * Reads DATABASE_URL, falling back to the documented default. The string is
 * built explicitly here rather than relying on Bun's implicit env detection
 * so the default is honoured and credentials are not scattered.
 */
export function connectionString(): string {
  const fromEnv = process.env.DATABASE_URL;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return DEFAULT_DATABASE_URL;
}

/**
 * Open a Bun.sql connection. Callers (notably tests) may pass an explicit
 * URL; otherwise the resolved application connection string is used. Tests
 * typically pass `process.env.TEST_DATABASE_URL ?? undefined` so an unset
 * override transparently falls back to the primary string.
 */
export function openDb(url: string = connectionString()): SQL {
  return new SQL(url);
}

/**
 * Create the schema and seed the catalogue if empty. Both operations are
 * idempotent, so awaiting this on every boot is safe: the first run creates
 * the tables and populates the catalogue, later runs are no-ops. Bun.sql is
 * async, so initialisation (and every call site) is now Promise-based.
 */
export async function initDb(database: SQL = db): Promise<SQL> {
  await initSchema(database);
  await seedIfEmpty(database);
  return database;
}

/**
 * The shared singleton connection used by the API route modules. Constructing
 * it at import time means the first `import { db }` wires up the connection;
 * `await initDb()` in server.ts applies the schema+seed before serving.
 */
export const db: SQL = openDb();

import { PGlite } from "@electric-sql/pglite";
import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type { MigrationClient } from "./migrate.js";
import { PGliteDialect } from "./pglite-dialect.js";
import type { DB } from "./schema.js";

/** Postgres type OIDs we parse ourselves. */
const INT8 = 20;
const parseInt8 = (v: string) => BigInt(v);

/**
 * Kysely over node-postgres. BIGINT columns (money in minor units, counters)
 * come back as JS bigint, never as lossy numbers or strings.
 *
 * `onIdleError` sees errors on *idle* pooled connections (server restart,
 * Cloud SQL failover or maintenance, idle timeout). The pool already drops
 * the broken connection; without a listener node-postgres would re-throw the
 * error as an uncaught exception and crash the process.
 */
export function createPgDb(connectionString: string, options: { max?: number; onIdleError?: (err: Error) => void } = {}): Kysely<DB> {
  const types = { getTypeParser: (oid: number, format?: "text" | "binary") => (oid === INT8 ? parseInt8 : pg.types.getTypeParser(oid, format)) };
  const pool = new pg.Pool({ connectionString, max: options.max ?? 10, types: types as pg.CustomTypesConfig });
  pool.on("error", (err) => options.onIdleError?.(err));
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}

/** In-process PGlite database (tests, local development). `dataDir` omitted = in memory. */
export async function createPglite(dataDir?: string): Promise<PGlite> {
  // One options object: PGlite 0.2 drops the options when the first argument is undefined.
  const db = new PGlite({ ...(dataDir ? { dataDir } : {}), parsers: { [INT8]: parseInt8 } });
  await db.waitReady;
  return db;
}

export function createPgliteDb(pglite: PGlite): Kysely<DB> {
  return new Kysely<DB>({ dialect: new PGliteDialect(pglite) });
}

export function pgliteMigrationClient(db: PGlite): MigrationClient {
  return {
    exec: async (sql) => { await db.exec(sql); },
    query: async <R>(sql: string, params?: unknown[]) => (await db.query<R>(sql, params)).rows,
  };
}

/** A single dedicated connection (migrations need one session for the advisory lock and transactions). */
export async function pgMigrationClient(connectionString: string): Promise<MigrationClient & { close(): Promise<void> }> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  return {
    exec: async (sql) => { await client.query(sql); },
    query: async <R>(sql: string, params?: unknown[]) => (await client.query(sql, params)).rows as R[],
    close: () => client.end(),
  };
}

import { PGlite } from "@electric-sql/pglite";
import { CompiledQuery, Kysely, PostgresDialect, type DatabaseConnection, type Driver, type TransactionSettings } from "kysely";
import pg from "pg";
import type { MigrationClient } from "./migrate.js";
import { PGliteDialect } from "./pglite-dialect.js";
import type { DB } from "./schema.js";
import { txOpening } from "./tenant.js";

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
export interface PgDbOptions {
  /** Pool size per process; keep instances × max within the server's connection budget (docs/09). */
  max?: number;
  /** Server-side cancel for any single statement (ms). Role settings do not apply after SET ROLE, so it is set per connection. */
  statementTimeoutMs?: number;
  /** Server closes a session left idle inside a transaction (ms): a leaked transaction cannot hold locks for long. */
  idleInTransactionTimeoutMs?: number;
  /** Fail fast when the pool is exhausted instead of queueing without bound (ms). */
  acquireTimeoutMs?: number;
  /** Shows up in pg_stat_activity. */
  applicationName?: string;
  onIdleError?: (err: Error) => void;
  /** Called for statements slower than `slowQueryMs`, with the SQL text only (parameters can hold personal data). */
  onSlowQuery?: (info: { sql: string; ms: number }) => void;
  slowQueryMs?: number;
}

const pools = new WeakMap<Kysely<DB>, pg.Pool>();

/**
 * H-12: node-postgres with BEGIN and a scoped transaction's opening statement (role, tenant) in one
 * simple query: `begin; select set_config(…)`. One round-trip fewer on every tenant, platform and
 * worker transaction (5 → 4 for a two-query read). Plain transactions open as before.
 */
class MergedBeginDialect extends PostgresDialect {
  override createDriver(): Driver {
    const driver = super.createDriver();
    const begin = driver.beginTransaction.bind(driver);
    driver.beginTransaction = async (connection: DatabaseConnection, settings: TransactionSettings) => {
      const opening = txOpening.getStore();
      if (!opening || opening.sent || settings.isolationLevel || settings.accessMode) return begin(connection, settings);
      opening.sent = true;
      await connection.executeQuery(CompiledQuery.raw(`begin; ${opening.sql}`));
    };
    return driver;
  }
}

/** Pool counters for metrics (undefined for PGlite). */
export function poolStats(db: Kysely<DB>): { total: number; idle: number; waiting: number } | undefined {
  const pool = pools.get(db);
  return pool ? { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount } : undefined;
}

export function createPgDb(connectionString: string, options: PgDbOptions = {}): Kysely<DB> {
  const types = { getTypeParser: (oid: number, format?: "text" | "binary") => (oid === INT8 ? parseInt8 : pg.types.getTypeParser(oid, format)) };
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? 10,
    types: types as pg.CustomTypesConfig,
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    idle_in_transaction_session_timeout: options.idleInTransactionTimeoutMs ?? 30_000,
    connectionTimeoutMillis: options.acquireTimeoutMs ?? 5_000,
    idleTimeoutMillis: 30_000,
    // Recycle connections so a failover or a re-balanced proxy is picked up.
    maxLifetimeSeconds: 1_800,
    application_name: options.applicationName ?? "mizan",
  });
  pool.on("error", (err) => options.onIdleError?.(err));
  const slowMs = options.slowQueryMs ?? 500;
  const db = new Kysely<DB>({
    dialect: new MergedBeginDialect({ pool }),
    ...(options.onSlowQuery
      ? {
          log: (event) => {
            if (event.queryDurationMillis >= slowMs) options.onSlowQuery!({ sql: event.query.sql.slice(0, 2_000), ms: Math.round(event.queryDurationMillis) });
          },
        }
      : {}),
  });
  pools.set(db, pool);
  return db;
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

import type { PGlite } from "@electric-sql/pglite";
import {
  CompiledQuery, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler,
  type DatabaseConnection, type Dialect, type Driver, type Kysely, type QueryResult,
} from "kysely";

/** BIGINT → bigint on every query, whatever parsers the PGlite instance was created with. */
const PARSERS = { 20: (v: string) => BigInt(v) };

/**
 * Kysely dialect for PGlite (Postgres in WebAssembly), used by tests and by
 * local development without a database server. PGlite is a single
 * connection, so queries are serialized through one connection with a lock.
 */
export class PGliteDialect implements Dialect {
  constructor(private readonly db: PGlite) {}

  createAdapter() { return new PostgresAdapter(); }
  createDriver(): Driver { return new PGliteDriver(this.db); }
  createIntrospector(db: Kysely<unknown>) { return new PostgresIntrospector(db); }
  createQueryCompiler() { return new PostgresQueryCompiler(); }
}

class PGliteDriver implements Driver {
  private queue: Promise<void> = Promise.resolve();
  private readonly connection: PGliteConnection;

  constructor(db: PGlite) {
    this.connection = new PGliteConnection(db);
  }

  async init(): Promise<void> {}

  async acquireConnection(): Promise<DatabaseConnection> {
    // One connection: wait for the previous holder to release it.
    let release!: () => void;
    const prev = this.queue;
    this.queue = new Promise((r) => { release = r; });
    await prev;
    this.connection.release = release;
    return this.connection;
  }

  async beginTransaction(conn: DatabaseConnection): Promise<void> {
    await conn.executeQuery(CompiledQuery.raw("BEGIN"));
  }

  async commitTransaction(conn: DatabaseConnection): Promise<void> {
    await conn.executeQuery(CompiledQuery.raw("COMMIT"));
  }

  async rollbackTransaction(conn: DatabaseConnection): Promise<void> {
    await conn.executeQuery(CompiledQuery.raw("ROLLBACK"));
  }

  async releaseConnection(conn: DatabaseConnection): Promise<void> {
    (conn as PGliteConnection).release?.();
  }

  async destroy(): Promise<void> {}
}

class PGliteConnection implements DatabaseConnection {
  release?: () => void;

  constructor(private readonly db: PGlite) {}

  async executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {
    const res = await this.db.query<R>(compiled.sql, compiled.parameters as unknown[], { parsers: PARSERS });
    return {
      rows: res.rows,
      ...(res.affectedRows !== undefined ? { numAffectedRows: BigInt(res.affectedRows) } : {}),
    };
  }

  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error("PGlite dialect does not support streaming");
  }
}

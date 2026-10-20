import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Migration runner for packages/db/migrations.
 *
 * - Files `NNNN_name.sql` run in order, each in its own transaction.
 * - Applied versions are recorded in `schema_migrations` with a checksum;
 *   editing an applied file is an error (write a new migration instead).
 * - A Postgres advisory lock keeps two migrators (two deploys) from racing.
 *
 * Runs as the migrator (schema owner), never as the app role.
 */

/** The two operations the runner needs; implemented for pg and PGlite in clients.ts. */
export interface MigrationClient {
  /** Run one or more statements (simple protocol, no parameters). */
  exec(sql: string): Promise<void>;
  /** Run one parameterized statement. */
  query<R>(sql: string, params?: unknown[]): Promise<R[]>;
}

export interface Migration {
  version: string;
  name: string;
  sql: string;
  checksum: string;
}

export const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations", import.meta.url));

const FILE = /^(\d{4})_([a-z0-9_]+)\.sql$/;
// Arbitrary, stable key for pg_advisory_lock: "mizan-migrate".
const LOCK_KEY = 4_812_771_203;

export function loadMigrations(dir = MIGRATIONS_DIR): Migration[] {
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const migrations = files.map((file) => {
    const m = FILE.exec(file);
    if (!m) throw new Error(`migration file name must look like 0001_name.sql: ${file}`);
    const sql = readFileSync(join(dir, file), "utf8");
    return { version: m[1]!, name: m[2]!, sql, checksum: createHash("sha256").update(sql).digest("hex") };
  });
  const seen = new Set<string>();
  for (const m of migrations) {
    if (seen.has(m.version)) throw new Error(`duplicate migration version ${m.version}`);
    seen.add(m.version);
  }
  return migrations;
}

export interface MigrateResult {
  applied: string[];
  skipped: string[];
}

export async function migrate(
  client: MigrationClient,
  options: { dir?: string; log?: (line: string) => void } = {},
): Promise<MigrateResult> {
  const log = options.log ?? (() => {});
  const migrations = loadMigrations(options.dir);

  await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
  try {
    await client.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      checksum   TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    const rows = await client.query<{ version: string; checksum: string }>("SELECT version, checksum FROM schema_migrations");
    const done = new Map(rows.map((r) => [r.version, r.checksum]));

    const result: MigrateResult = { applied: [], skipped: [] };
    for (const m of migrations) {
      const prior = done.get(m.version);
      if (prior !== undefined) {
        if (prior !== m.checksum) {
          throw new Error(`migration ${m.version}_${m.name} was changed after it was applied; add a new migration instead`);
        }
        result.skipped.push(m.version);
        continue;
      }
      log(`applying ${m.version}_${m.name}`);
      await client.exec("BEGIN");
      try {
        await client.exec(m.sql);
        await client.query("INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)", [m.version, m.name, m.checksum]);
        await client.exec("COMMIT");
      } catch (err) {
        await client.exec("ROLLBACK");
        throw new Error(`migration ${m.version}_${m.name} failed: ${(err as Error).message}`, { cause: err });
      }
      result.applied.push(m.version);
    }
    return result;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]);
  }
}

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgDb, pgMigrationClient } from "../src/clients.js";
import { ensureAppLogin, loadMigrations, migrate } from "../src/migrate.js";
import { asWorker, withTenant } from "../src/tenant.js";

/**
 * Same guarantees as tenant.test.ts, on a real PostgreSQL server with the
 * production driver (node-postgres) and a non-owner login role — the shape
 * of Cloud SQL. Runs in CI against a postgres service; locally:
 *   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres npm test -w @mizan/db
 */
const ADMIN_URL = process.env.TEST_DATABASE_URL;
const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

describe.skipIf(!ADMIN_URL)("PostgreSQL (node-postgres)", () => {
  const suffix = randomBytes(4).toString("hex");
  const dbName = `mizan_test_${suffix}`;
  const loginRole = `mizan_api_${suffix}`;
  const password = randomBytes(12).toString("hex");
  let admin: pg.Client;
  let migratorUrl: string;
  let appUrl: string;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    const base = new URL(ADMIN_URL!);
    base.pathname = `/${dbName}`;
    migratorUrl = base.toString();
    const app = new URL(migratorUrl);
    app.username = loginRole;
    app.password = password;
    appUrl = app.toString();
  });

  afterAll(async () => {
    // Every pool used here was destroyed in its test; FORCE only ends stray sessions.
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.query(`DROP ROLE IF EXISTS ${loginRole}`);
    await admin.query(`DROP ROLE IF EXISTS mizan_login_${suffix}`);
    await admin.end();
  });

  it("migrates with the CLI, idempotently", async () => {
    if (existsSync(cli)) {
      const out = execFileSync(process.execPath, [cli, "migrate"], { env: { PATH: process.env.PATH, DATABASE_URL_MIGRATOR: migratorUrl }, encoding: "utf8" });
      expect(out).toContain(`${loadMigrations().length} applied`);
    } else {
      const client = await pgMigrationClient(migratorUrl);
      await migrate(client);
      await client.close();
    }
    const again = await pgMigrationClient(migratorUrl);
    expect((await migrate(again)).applied).toEqual([]);
    await again.close();
  });

  it("creates the API login with only the RLS-bound roles, and rotates its password (E1-11)", async () => {
    const name = `mizan_login_${suffix}`;
    const first = randomBytes(18).toString("base64url");
    const env = { PATH: process.env.PATH, DATABASE_URL_MIGRATOR: migratorUrl, DATABASE_APP_LOGIN: name, DATABASE_APP_PASSWORD: first };
    const run = (e: Record<string, string | undefined>) => (existsSync(cli) ? execFileSync(process.execPath, [cli, "migrate"], { env: e, encoding: "utf8" }) : null);
    const out = run(env);
    if (out === null) {
      const client = await pgMigrationClient(migratorUrl);
      await ensureAppLogin(client, name, first);
      await client.close();
    } else {
      expect(out).toContain(`app login ${name}: created`);
      expect(out).not.toContain(first);
    }
    const role = (await admin.query(`SELECT rolcanlogin, rolbypassrls, rolsuper, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = $1`, [name])).rows[0];
    expect(role).toEqual({ rolcanlogin: true, rolbypassrls: false, rolsuper: false, rolcreaterole: false, rolcreatedb: false });
    const member = (await admin.query(`SELECT r.rolname FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid JOIN pg_roles u ON u.oid = m.member WHERE u.rolname = $1 ORDER BY 1`, [name])).rows.map((r) => r.rolname);
    expect(member).toEqual(["mizan_app", "mizan_platform", "mizan_worker"]);
    const as = (pw: string) => { const u = new URL(migratorUrl); u.username = name; u.password = pw; return u.toString(); };
    const c1 = new pg.Client({ connectionString: as(first) });
    await c1.connect();
    await c1.end();
    // A new secret, a redeploy: the stored password changes (the test server may trust local logins, so compare hashes).
    const hash = async () => (await admin.query(`SELECT rolpassword FROM pg_authid WHERE rolname = $1`, [name])).rows[0].rolpassword as string;
    const before = await hash();
    const second = randomBytes(18).toString("base64url");
    const client = await pgMigrationClient(migratorUrl);
    await ensureAppLogin(client, name, second);
    await expect(ensureAppLogin(client, "Robert'); DROP TABLE x;--", second)).rejects.toThrow(/not a role name/);
    await expect(ensureAppLogin(client, name, "short")).rejects.toThrow(/at least 24/);
    // A login that gained BYPASSRLS by hand is refused, never silently kept.
    await admin.query(`ALTER ROLE ${name} BYPASSRLS`);
    await expect(ensureAppLogin(client, name, second)).rejects.toThrow(/must not be a superuser or bypass RLS/);
    await admin.query(`ALTER ROLE ${name} NOBYPASSRLS`);
    await client.close();
    expect(await hash()).not.toBe(before);
  });

  it("cancels a runaway statement, logs slow ones without parameters, and fails fast when the pool is exhausted", async () => {
    const slow: Array<{ sql: string; ms: number }> = [];
    const db = createPgDb(migratorUrl, { max: 1, statementTimeoutMs: 300, slowQueryMs: 100, acquireTimeoutMs: 200, onSlowQuery: (s) => slow.push(s) });
    try {
      await expect(sql`SELECT pg_sleep(2)`.execute(db)).rejects.toThrow(/statement timeout/);
      await sql`SELECT pg_sleep(0.15), ${"01001234821"}::text AS phone`.execute(db);
      expect(slow.some((s) => s.sql.includes("pg_sleep(0.15)") && s.ms >= 100)).toBe(true);
      expect(JSON.stringify(slow)).not.toContain("01001234821");
      // The only connection is busy: a second caller gets an error quickly instead of waiting forever.
      const busy = sql`SELECT pg_sleep(0.25)`.execute(db);
      const t0 = Date.now();
      await expect(sql`SELECT 1`.execute(db)).rejects.toThrow(/timeout/i);
      expect(Date.now() - t0).toBeLessThan(1_000);
      await busy;
    } finally {
      await db.destroy();
    }
  });

  it("survives the server killing idle pooled connections (failover, maintenance) without crashing", async () => {
    const lost: Error[] = [];
    const db = createPgDb(migratorUrl, { max: 3, onIdleError: (e) => lost.push(e) });
    try {
      // Fill the pool, then leave the connections idle.
      await Promise.all([1, 2, 3].map(() => db.selectFrom("tenants").select("id").execute()));
      const killed = await admin.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid() AND state = 'idle'", [dbName]);
      expect(killed.rowCount).toBeGreaterThan(0);
      // Each killed idle connection is reported (not thrown as an uncaught exception)…
      for (let i = 0; i < 100 && lost.length < killed.rowCount!; i++) await new Promise((r) => setTimeout(r, 20));
      expect(lost).toHaveLength(killed.rowCount!);
      expect(lost[0]!.message).toMatch(/terminating connection/);
      // …and dropped from the pool, which recovers with fresh connections.
      expect(await db.selectFrom("tenants").select("id").execute()).toBeInstanceOf(Array);
    } finally {
      await db.destroy();
    }
  });

  it("a non-owner login role, through withTenant, cannot cross tenants", async () => {
    // What infrastructure does in Cloud SQL: a login user that is a member of mizan_app.
    await admin.query(`CREATE ROLE ${loginRole} LOGIN PASSWORD '${password}' IN ROLE mizan_app, mizan_worker`);
    const owner = createPgDb(migratorUrl);
    await owner.insertInto("tenants").values([{ id: A, name: "A", slug: "a" }, { id: B, name: "B", slug: "b" }]).execute();
    await owner.destroy();

    const db = createPgDb(appUrl, { max: 4 });
    try {
      await withTenant(db, A, (trx) => trx.insertInto("orders").values({ tenant_id: A, number: "#A-1", currency: "KWD", total_minor: 9007199254740993n, placed_at: new Date() }).execute());
      await withTenant(db, B, (trx) => trx.insertInto("orders").values({ tenant_id: B, number: "#B-1", currency: "EGP", total_minor: 1n, placed_at: new Date() }).execute());

      // Concurrent transactions on a pool: settings are per transaction, never per connection.
      const reads = await Promise.all(Array.from({ length: 16 }, (_, i) => {
        const t = i % 2 ? A : B;
        return withTenant(db, t, async (trx) => ({ t, rows: await trx.selectFrom("orders").select(["tenant_id", "total_minor"]).execute() }));
      }));
      for (const { t, rows } of reads) {
        expect(rows).toHaveLength(1);
        expect(rows[0]!.tenant_id).toBe(t);
      }
      // BIGINT beyond 2^53 survives exactly (money in minor units).
      expect(reads.find((r) => r.t === A)!.rows[0]!.total_minor).toBe(9007199254740993n);

      await expect(withTenant(db, A, (trx) => trx.insertInto("orders").values({ tenant_id: B, number: "#x", currency: "EGP", total_minor: 1n, placed_at: new Date() }).execute()))
        .rejects.toThrow(/row-level security/);
      // Outside withTenant the login role sees no tenant rows at all.
      expect(await db.selectFrom("orders").selectAll().execute()).toEqual([]);

      // H-12: BEGIN and the tenant's settings travel together: a one-query read is 3 round-trips.
      const query = pg.Client.prototype.query;
      const sent: string[] = [];
      pg.Client.prototype.query = function (this: pg.Client, ...args: Parameters<typeof query>) {
        if (typeof args[0] === "string") sent.push(args[0]);
        return (query as (...a: unknown[]) => unknown).apply(this, args);
      } as typeof query;
      try {
        await withTenant(db, A, (trx) => trx.selectFrom("orders").select("id").execute());
      } finally {
        pg.Client.prototype.query = query;
      }
      expect(sent).toHaveLength(3);
      expect(sent[0]).toMatch(/^begin; SELECT set_config\('role', 'mizan_app', true\), set_config\('app.tenant_id', 'aaaaaaaa-/);
      expect(sent[2]).toBe("commit");
      // A plain transaction started inside one opens normally (no tenant), and nothing outlives a rolled-back one.
      await withTenant(db, A, async () => {
        const inner = await db.transaction().execute((trx) => sql<{ t: string | null }>`SELECT current_setting('app.tenant_id', true) AS t`.execute(trx));
        expect(inner.rows[0]!.t ?? "").toBe("");
      });
      const one = createPgDb(appUrl, { max: 1 });
      try {
        await expect(withTenant(one, A, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
        const after = await sql<{ t: string | null; r: string }>`SELECT current_setting('app.tenant_id', true) AS t, current_user AS r`.execute(one);
        expect([after.rows[0]!.t ?? "", after.rows[0]!.r]).toEqual(["", loginRole]);
      } finally {
        await one.destroy();
      }

      // The dispatcher role reads domain_events across tenants, and nothing else.
      for (const t of [A, B]) {
        await withTenant(db, t, (trx) => trx.insertInto("domain_events").values({ tenant_id: t, type: "order.created", entity_type: "order", entity_id: t }).execute());
      }
      const events = await asWorker(db, (trx) => trx.selectFrom("domain_events").select("tenant_id").execute());
      expect(events.map((e) => e.tenant_id).sort()).toEqual([A, B]);
      await expect(asWorker(db, (trx) => trx.selectFrom("orders").selectAll().execute())).rejects.toThrow(/permission denied/);
      // Retention may delete only finished rows: these events are not dispatched yet (0012).
      const deleted = await asWorker(db, (trx) => trx.deleteFrom("domain_events").executeTakeFirst());
      expect(deleted.numDeletedRows).toBe(0n);
    } finally {
      await db.destroy();
    }
  });
});

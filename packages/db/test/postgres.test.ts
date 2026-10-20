import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgDb, pgMigrationClient } from "../src/clients.js";
import { loadMigrations, migrate } from "../src/migrate.js";
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
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.query(`DROP ROLE IF EXISTS ${loginRole}`);
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

      // The dispatcher role reads domain_events across tenants, and nothing else.
      for (const t of [A, B]) {
        await withTenant(db, t, (trx) => trx.insertInto("domain_events").values({ tenant_id: t, type: "order.created", entity_type: "order", entity_id: t }).execute());
      }
      const events = await asWorker(db, (trx) => trx.selectFrom("domain_events").select("tenant_id").execute());
      expect(events.map((e) => e.tenant_id).sort()).toEqual([A, B]);
      await expect(asWorker(db, (trx) => trx.selectFrom("orders").selectAll().execute())).rejects.toThrow(/permission denied/);
      await expect(asWorker(db, (trx) => trx.deleteFrom("domain_events").execute())).rejects.toThrow(/permission denied/);
    } finally {
      await db.destroy();
    }
  });
});

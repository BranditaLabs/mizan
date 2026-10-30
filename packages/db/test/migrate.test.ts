import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { pgliteMigrationClient } from "../src/clients.js";
import { loadMigrations, migrate } from "../src/migrate.js";

function dirWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "mizan-mig-"));
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql);
  return dir;
}

describe("loadMigrations", () => {
  it("loads the repo migrations in order with checksums", () => {
    const ms = loadMigrations();
    expect(ms.map((m) => m.version)).toEqual([...ms.map((m) => m.version)].sort());
    expect(ms.slice(0, 3).map((m) => `${m.version}_${m.name}`)).toEqual(["0001_core", "0002_commerce_os", "0003_app_role"]);
    expect(ms[0]!.checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it("a Windows checkout (CRLF) has the same checksum as what Linux applied (LF)", () => {
    const lf = loadMigrations(dirWith({ "0001_a.sql": "CREATE TABLE a (id INT);\nSELECT 1;\n" }))[0]!;
    const crlf = loadMigrations(dirWith({ "0001_a.sql": "CREATE TABLE a (id INT);\r\nSELECT 1;\r\n" }))[0]!;
    expect(crlf.checksum).toBe(lf.checksum);
    expect(loadMigrations(dirWith({ "0001_a.sql": "CREATE TABLE a (id INT);\nSELECT 2;\n" }))[0]!.checksum).not.toBe(lf.checksum);
  });

  it("rejects bad names and duplicate versions", () => {
    expect(() => loadMigrations(dirWith({ "1_x.sql": "" }))).toThrow(/0001_name\.sql/);
    expect(() => loadMigrations(dirWith({ "0001_a.sql": "", "0001_b.sql": "" }))).toThrow(/duplicate migration version 0001/);
  });
});

describe("migrate", () => {
  it("applies the real migrations once, then skips them", async () => {
    const db = new PGlite();
    const client = pgliteMigrationClient(db);
    const first = await migrate(client);
    expect(first.applied).toEqual(loadMigrations().map((m) => m.version));
    const second = await migrate(client);
    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(first.applied);
    const roles = await client.query<{ rolbypassrls: boolean }>("SELECT rolbypassrls FROM pg_roles WHERE rolname = 'mizan_app'");
    expect(roles).toEqual([{ rolbypassrls: false }]);
    await db.close();
  });

  it("rolls back a failing migration completely and reports which one", async () => {
    const db = new PGlite();
    const client = pgliteMigrationClient(db);
    const dir = dirWith({
      "0001_ok.sql": "CREATE TABLE a (id int);",
      "0002_bad.sql": "CREATE TABLE b (id int); SELECT * FROM missing_table;",
    });
    await expect(migrate(client, { dir })).rejects.toThrow(/migration 0002_bad failed/);
    const tables = await client.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1");
    expect(tables.map((t) => t.table_name)).toEqual(["a", "schema_migrations"]);
    expect(await client.query("SELECT version FROM schema_migrations")).toEqual([{ version: "0001" }]);
    await db.close();
  });

  it("refuses to continue when an applied migration was edited", async () => {
    const db = new PGlite();
    const client = pgliteMigrationClient(db);
    const dir = dirWith({ "0001_a.sql": "CREATE TABLE a (id int);" });
    await migrate(client, { dir });
    writeFileSync(join(dir, "0001_a.sql"), "CREATE TABLE a (id bigint);");
    await expect(migrate(client, { dir })).rejects.toThrow(/0001_a was changed after it was applied/);
    await db.close();
  });

  it("a database that recorded a CRLF file's raw checksum carries on, and is recorded the new way", async () => {
    const db = new PGlite();
    const client = pgliteMigrationClient(db);
    const dir = dirWith({ "0001_a.sql": "CREATE TABLE a (id int);\r\n" });
    const [m] = loadMigrations(dir);
    await client.exec("CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
    await client.exec("CREATE TABLE a (id int)");
    await client.query("INSERT INTO schema_migrations (version, name, checksum) VALUES ('0001', 'a', $1)", [m!.rawChecksum]);
    expect(await migrate(client, { dir })).toEqual({ applied: [], skipped: ["0001"] });
    expect(await client.query("SELECT checksum FROM schema_migrations")).toEqual([{ checksum: m!.checksum }]);
    writeFileSync(join(dir, "0001_a.sql"), "CREATE TABLE a (id int);\n"); // the same file from a Linux checkout
    expect((await migrate(client, { dir })).skipped).toEqual(["0001"]);
    await db.close();
  });
});

import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";

let app: INestApplication;
let db: Database;

beforeAll(async () => {
  // No DATABASE_URL: in-memory PGlite, migrated at boot (same path as `npm run dev`).
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "http://localhost", WEB_URL: "http://localhost:3000" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, done) => done() }) });
  await app.init();
  db = app.get(Database);
  await db.kysely.insertInto("tenants").values([{ id: A, name: "A", slug: "a" }, { id: B, name: "B", slug: "b" }]).execute();
});
afterAll(() => app.close());

describe("Database in the API", () => {
  it("GET /health/ready answers when the database does", async () => {
    await request(app.getHttpServer()).get("/health/ready").expect(200, { status: "ready" });
  });

  it("a request scoped to tenant A cannot read tenant B", async () => {
    const order = (tenant: string, number: string) =>
      ({ tenant_id: tenant, number, currency: "EGP", total_minor: 1000n, placed_at: new Date() });
    await db.tenant(A, (trx) => trx.insertInto("orders").values(order(A, "#A-1")).execute());
    await db.tenant(B, (trx) => trx.insertInto("orders").values(order(B, "#B-1")).execute());

    const forA = await db.tenant(A, (trx) => trx.selectFrom("orders").select("number").execute());
    const forB = await db.tenant(B, (trx) => trx.selectFrom("orders").select("number").execute());
    expect(forA).toEqual([{ number: "#A-1" }]);
    expect(forB).toEqual([{ number: "#B-1" }]);
    expect(await db.platform((trx) => trx.selectFrom("orders").selectAll().execute())).toEqual([]);
  });

  it("parallel requests for different tenants stay isolated", async () => {
    const reads = await Promise.all(
      Array.from({ length: 20 }, (_, i) => {
        const t = i % 2 ? A : B;
        return db.tenant(t, async (trx) => ({ t, rows: await trx.selectFrom("orders").select("tenant_id").execute() }));
      }),
    );
    for (const { t, rows } of reads) expect(rows.every((r) => r.tenant_id === t)).toBe(true);
  });

  it("readiness fails with a 503 problem when the database is gone", async () => {
    const broken = await createApp(loadConfig({ NODE_ENV: "test", PUBLIC_URL: "http://localhost", WEB_URL: "http://localhost:3000" }),
      { logDestination: new Writable({ write: (_c, _e, done) => done() }) });
    await broken.init();
    await broken.get(Database).close();
    const res = await request(broken.getHttpServer()).get("/health/ready").set("Accept-Language", "en").expect(503);
    expect(res.body).toMatchObject({ code: "service_unavailable", detail: "database unreachable" });
    await broken.close().catch(() => {});
  });
});

import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { pagePath } from "../src/modules/feedback/feedback.dto.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { FakeVerifier } from "./support/fake-auth.js";

/**
 * L1-8: any member of a store sends feedback from the screen they are on (path only, 10 an hour);
 * Mizan staff read every store's feedback in the back office and move it along, in the staff trail.
 * A store never reads feedback back, not even its own.
 */
const fake = new FakeVerifier();
let app: INestApplication;
let shop: string;
const http = () => request(app.getHttpServer());
const as = (token: string, tenant?: string, lang = "en") => ({ Authorization: `Bearer ${token}`, "Accept-Language": lang, ...(tenant ? { "X-Tenant-Id": tenant } : {}) });

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test", PLATFORM_BOOTSTRAP_EMAILS: "boss@mizan.test" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  fake.add("boss", { uid: "fb-boss-l18", email: "boss@mizan.test", emailVerified: true, secondFactor: "totp" });
  fake.add("money", { uid: "fb-money-l18", email: "money@mizan.test", emailVerified: true, secondFactor: "phone" });
  fake.add("owner", { uid: "fb-owner-l18", email: "owner@nile.test", emailVerified: true, secondFactor: "phone" });
  shop = (await http().post("/v1/tenants").set(as("owner")).send({ name: "Nile Feedback", country: "EG" }).expect(201)).body.id;
  const inv = await http().post("/v1/members/invite").set(as("owner", shop)).send({ phone: "01201118881", role: "warehouse" }).expect(201);
  fake.add("wh", { uid: "fb-wh-l18", phone: inv.body.phone });
  await http().post(`/v1/invitations/${inv.body.id}/accept`).set(as("wh")).expect(200);
  await http().get("/v1/me").set(as("money")).expect(200);
  await http().get("/v1/platform/me").set(as("boss")).expect(200);
  await http().post("/v1/platform/staff").set(as("boss")).send({ email: "money@mizan.test", role: "finance" }).expect(201);
});
afterAll(() => app.close());

describe("page paths (L1-8)", () => {
  it("keeps only the path: no origin, query string, fragment or control characters, at most 300 characters", () => {
    expect(pagePath("/ar/orders?phone=01001234821#top")).toBe("/ar/orders");
    expect(pagePath("https://app.mizan.test/en/reports?token=abc")).toBe("/en/reports");
    expect(pagePath("en/orders/123")).toBe("/en/orders/123");
    expect(pagePath("/ar/x\u0000\nsecret")).toBe("/ar/xsecret");
    expect(pagePath("")).toBe("/");
    expect(pagePath(`/${"a".repeat(400)}`)).toHaveLength(300);
  });
});

describe("in-app feedback (L1-8)", () => {
  let first: string;

  it("any member sends it; the page is kept as a path; bad input is refused", async () => {
    const r = await http().post("/v1/feedback").set(as("wh", shop, "ar")).send({ kind: "problem", message: "  زرار التصدير مش بيعمل حاجة  ", page: "/ar/reports?days=30#tiles" }).expect(201);
    expect(r.body).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(r.headers["ratelimit-policy"]).toBe('10;w=3600;policy="feedback"');
    first = r.body.id;
    await http().post("/v1/feedback").set(as("owner", shop)).send({ kind: "idea", message: "Weekly report by WhatsApp", page: "https://app.mizan.test/en/home?x=1" }).expect(201);
    await http().post("/v1/feedback").set(as("owner", shop)).send({ kind: "rant", message: "x", page: "/" }).expect(422);
    await http().post("/v1/feedback").set(as("owner", shop)).send({ kind: "idea", message: "   ", page: "/" }).expect(422);
    await http().post("/v1/feedback").set(as("owner", shop)).send({ kind: "idea", message: "x".repeat(2001), page: "/" }).expect(422);
    await http().post("/v1/feedback").set(as("owner", shop)).send({ kind: "idea", message: "x", page: "/", storeId: shop }).expect(422); // nothing else
    await http().post("/v1/feedback").set(as("owner")).send({ kind: "idea", message: "no store", page: "/" }).expect(400); // a store is needed

    const rows = await app.get(Database).staff((trx) => trx.selectFrom("feedback").selectAll().where("id", "=", first).execute());
    expect(rows).toEqual([expect.objectContaining({ store_id: shop, kind: "problem", message: "زرار التصدير مش بيعمل حاجة", page: "/ar/reports", locale: "ar", status: "new" })]);
  });

  it("refuses the eleventh in an hour from the same person", async () => {
    // wh sent 1 above; 9 more are fine, the 11th is refused with Retry-After.
    for (let i = 0; i < 9; i++) await http().post("/v1/feedback").set(as("wh", shop)).send({ kind: "question", message: `question ${i}`, page: "/en/stock" }).expect(201);
    const refused = await http().post("/v1/feedback").set(as("wh", shop)).send({ kind: "question", message: "one more", page: "/en/stock" }).expect(429);
    expect(refused.body.code).toBe("rate_limited");
    expect(Number(refused.headers["retry-after"])).toBeGreaterThan(60);
    await http().post("/v1/feedback").set(as("owner", shop)).send({ kind: "question", message: "someone else", page: "/en/stock" }).expect(201); // per person
  });

  it("staff read every store's feedback, newest first, with the store and the person; a store member cannot", async () => {
    const page = (await http().get("/v1/platform/feedback?limit=5").set(as("money")).expect(200)).body;
    expect(page.total).toBe(12);
    expect(page.nextOffset).toBe(5);
    expect(page.data).toHaveLength(5);
    const all = (await http().get("/v1/platform/feedback?limit=100").set(as("boss")).expect(200)).body.data;
    const times = all.map((f: { createdAt: string }) => f.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
    const mine = all.find((f: { id: string }) => f.id === first);
    expect(mine).toMatchObject({
      kind: "problem", page: "/ar/reports", locale: "ar", status: "new", store: { id: shop, name: "Nile Feedback" },
      person: { id: expect.any(String), name: null, email: null },
    });
    const idea = all.find((f: { kind: string }) => f.kind === "idea");
    expect(idea).toMatchObject({ page: "/en/home", locale: "en", person: { email: "owner@nile.test" } });

    expect((await http().get("/v1/platform/feedback").set(as("owner", shop)).expect(403)).body.code).toBe("not_staff");
    await http().get("/v1/feedback").set(as("owner", shop)).expect(404); // there is no store-side reading
    await http().get("/v1/platform/feedback?status=closed").set(as("boss")).expect(422);
  });

  it("staff move feedback from new to seen to done, each change in the staff trail", async () => {
    const seen = (await http().patch(`/v1/platform/feedback/${first}`).set(as("money")).send({ status: "seen" }).expect(200)).body;
    expect(seen).toMatchObject({ id: first, status: "seen" });
    await http().patch(`/v1/platform/feedback/${first}`).set(as("boss")).send({ status: "done" }).expect(200);
    await http().patch(`/v1/platform/feedback/${first}`).set(as("boss")).send({ status: "done" }).expect(200); // the same: nothing to record
    await http().patch(`/v1/platform/feedback/${first}`).set(as("boss")).send({ status: "closed" }).expect(422);
    await http().patch(`/v1/platform/feedback/${first}`).set(as("boss")).send({ status: "done", message: "edited" }).expect(422);
    await http().patch("/v1/platform/feedback/00000000-0000-4000-8000-000000000000").set(as("boss")).send({ status: "seen" }).expect(404);
    expect((await http().patch(`/v1/platform/feedback/${first}`).set(as("owner", shop)).send({ status: "new" }).expect(403)).body.code).toBe("not_staff");

    const open = (await http().get("/v1/platform/feedback?status=new&limit=100").set(as("boss")).expect(200)).body;
    expect(open.data.some((f: { id: string }) => f.id === first)).toBe(false);
    expect(open.total).toBe(11);
    expect((await http().get("/v1/platform/feedback?status=done").set(as("boss")).expect(200)).body.data.map((f: { id: string }) => f.id)).toEqual([first]);

    const trail = await app.get(Database).staff((trx) => trx.selectFrom("platform_audit").select(["action", "outcome", "target_id", "store_id", "data"])
      .where("target_type", "=", "feedback").orderBy("id").execute());
    expect(trail).toEqual([
      { action: "feedback.status_changed", outcome: "ok", target_id: first, store_id: shop, data: { before: "new", after: "seen" } },
      { action: "feedback.status_changed", outcome: "ok", target_id: first, store_id: shop, data: { before: "seen", after: "done" } },
    ]);
    const calls = await app.get(Database).staff((trx) => trx.selectFrom("platform_audit").select(["action", "outcome"]).where("action", "like", "% /v1/platform/feedback%").execute());
    expect(calls).toEqual(expect.arrayContaining([{ action: "PATCH /v1/platform/feedback/:id", outcome: "ok" }, { action: "GET /v1/platform/feedback", outcome: "ok" }, { action: "PATCH /v1/platform/feedback/:id", outcome: "denied" }]));
  });
});

import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { EventDispatcher } from "../src/platform/events/dispatcher.js";
import { BillingScheduler } from "../src/modules/billing/billing.scheduler.js";
import { SubscriptionService } from "../src/modules/billing/subscription.service.js";
import { FakeVerifier } from "./support/fake-auth.js";

/**
 * E12-2a3: no trial outlives day 7. Time travel: the scheduler runs at day 8 and the store drops to
 * Free (D3) while orders keep flowing; plan gating (behind the per-store `entitlements` flag)
 * answers 402 plan_required for a feature the plan lacks, never a 404.
 */
const fake = new FakeVerifier();
let app: INestApplication;
let db: Database;
let store: string;
let open: string;
let n = 0;
const http = () => request(app.getHttpServer());
const as = (token: string, tenant = store) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", "X-Tenant-Id": tenant });
const drain = async () => { const d = app.get(EventDispatcher); while ((await d.runOnce()).claimed > 0) { /* until empty */ } };
const order = async () => {
  n++;
  const r = await http().post("/v1/orders").set(as("owner")).send({
    source: "phone", customer: { name: "Mona Adel", phone: `0100${String(4000000 + n)}` }, address: { line1: "12 Abbas El Akkad St", city: "Nasr City" },
    lines: [{ title: "Abaya", quantity: 1, unitPrice: "450.00" }], payment: { mode: "cod" },
  }).expect(201);
  await drain();
  return r.body.id as string;
};
const subscription = async (token = "owner", tenant = store) => (await http().get("/v1/billing/subscription").set(as(token, tenant)).expect(200)).body;
const DAY = 86_400_000;

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  db = app.get(Database);
  fake.add("owner", { uid: "fb-owner-trialend", email: "owner@trialend.test", emailVerified: true, secondFactor: "phone" });
  fake.add("other", { uid: "fb-other-trialend", email: "other@trialend.test", emailVerified: true, secondFactor: "phone" });
  store = (await http().post("/v1/tenants").set({ Authorization: "Bearer owner" }).send({ name: "Trial End", country: "EG" }).expect(201)).body.id;
  open = (await http().post("/v1/tenants").set({ Authorization: "Bearer other" }).send({ name: "No Gating", country: "EG" }).expect(201)).body.id;
  // Gating on for the first store only (off for everyone else, as in production until pilots are comped).
  await db.kysely.insertInto("feature_flags").values({ key: "entitlements", enabled: false }).execute();
  await db.kysely.insertInto("feature_flag_stores").values({ flag_key: "entitlements", tenant_id: store, enabled: true }).execute();
});
afterAll(() => app.close());

describe("end of trial (E12-2a3)", () => {
  it("shows the trial with its days left in the store's time zone", async () => {
    const s = await subscription();
    expect(s).toMatchObject({ plan: "growth", status: "trialing", subscribedPlan: "growth", interval: "month", comped: false, timezone: "Africa/Cairo", lastTrial: null });
    expect(s.trial).toMatchObject({ plan: "growth", daysLeft: 7 });
  });

  it("gates a feature the plan lacks with 402 plan_required, only where the flag is on", async () => {
    const r = await http().get("/v1/suppliers").set(as("owner")).expect(402); // purchasing is Scale's; the trial is Growth
    expect(r.body).toMatchObject({ code: "plan_required", errors: [{ path: "feature", code: "purchasing" }, { path: "plan", code: "scale" }] });
    await http().get("/v1/suppliers").set(as("other", open)).expect(200); // flag off: as before
  });

  it("day 8: the scheduler ends the trial into Free, once; orders keep flowing", async () => {
    const before = await order();
    const scheduler = app.get(BillingScheduler);
    expect(await scheduler.runOnce(new Date(Date.now() + DAY))).toBe(0); // day 2: nothing is due
    expect(await scheduler.runOnce(new Date(Date.now() + 8 * DAY))).toBe(2); // both stores' trials
    expect(await scheduler.runOnce(new Date(Date.now() + 8 * DAY))).toBe(0); // safe to repeat
    const s = await subscription();
    expect(s).toMatchObject({ plan: "free", status: "active", subscribedPlan: "free", trial: null, lastTrial: { plan: "growth" } });
    const subs = await db.tenant(store, (trx) => trx.selectFrom("subscriptions").select(["plan_code", "status"]).orderBy("created_at").execute());
    expect(subs).toEqual([{ plan_code: "growth", status: "expired" }, { plan_code: "free", status: "active" }]);
    const events = await db.tenant(store, (trx) => trx.selectFrom("domain_events").select(["type", "data"]).where("type", "in", ["subscription.trial_ended", "subscription.plan_changed"]).execute());
    expect(events.map((e) => [e.type, e.data])).toHaveLength(3);
    expect(events.map((e) => [e.type, e.data])).toEqual(expect.arrayContaining([
      ["subscription.plan_changed", { from: "free", to: "growth", by: "user" }], // the signup trial
      ["subscription.trial_ended", { plan: "growth", outcome: "downgrade_free" }],
      ["subscription.plan_changed", { from: "growth", to: "free", by: "system" }],
    ]));
    // Orders keep flowing on Free: a new one is taken and listed with the old one.
    const after = await order();
    const list = (await http().get("/v1/orders").set(as("owner")).expect(200)).body.data.map((o: { id: string }) => o.id);
    expect(list).toEqual(expect.arrayContaining([before, after]));
    expect((await http().get("/v1/usage").set(as("owner")).expect(200)).body.plan).toBe("free");
  });

  it("a paid plan set by staff lifts the gate at once; a stale write is refused", async () => {
    const svc = app.get(SubscriptionService);
    const live = await db.tenant(store, (trx) => svc.live(trx, store));
    await db.tenant(store, (trx) => svc.override(trx, store, "scale", { actor: { type: "system" } }));
    await http().get("/v1/suppliers").set(as("owner")).expect(200);
    await expect(db.tenant(store, (trx) => svc.transition(trx, store, live!.id, "pause", { actor: { type: "system" }, expectedVersion: live!.version }))).rejects.toMatchObject({ code: "version_conflict" });
  });
});

import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import { sql } from "kysely";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { TrialDomainConsumer } from "../src/modules/billing/trial-domain.consumer.js";
import { BillingScheduler } from "../src/modules/billing/billing.scheduler.js";
import { SubscriptionService } from "../src/modules/billing/subscription.service.js";
import { FakeVerifier } from "./support/fake-auth.js";

/**
 * E12-2a2: a new store starts a 7-day trial of the tier it picked, in the same transaction as the
 * store, ending 23:59:59 on day 7 in its time zone; once per owner, phone and shop domain.
 */
const fake = new FakeVerifier();
let app: INestApplication;
let db: Database;
const http = () => request(app.getHttpServer());
const as = (token: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en" });
const signup = (token: string, body: Record<string, unknown>, status = 201) => http().post("/v1/tenants").set(as(token)).send({ country: "EG", ...body }).expect(status);
const subOf = (tenant: string) => db.tenant(tenant, (trx) => trx.selectFrom("subscriptions").selectAll().where("status", "not in", ["cancelled", "expired"]).executeTakeFirstOrThrow());
const setSettings = (set: string) => db.kysely.executeQuery(sql.raw(`UPDATE billing_settings SET ${set}`).compile(db.kysely));

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "http://localhost", WEB_URL: "http://localhost:3000" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  db = app.get(Database);
  fake.add("mona", { uid: "fb-mona-trial", email: "mona@trial.test", emailVerified: true, phone: "+201001112233" });
  fake.add("karim", { uid: "fb-karim-trial", phone: "+201001112233" }); // Mona's phone, another account
  fake.add("lina", { uid: "fb-lina-trial", email: "lina@trial.test", emailVerified: true });
  fake.add("sami", { uid: "fb-sami-trial", email: "sami@trial.test", emailVerified: true });
  fake.add("riyad", { uid: "fb-riyad-trial", email: "riyad@trial.test", emailVerified: true });
  fake.add("nour", { uid: "fb-nour-trial", email: "nour@trial.test", emailVerified: true });
});
afterAll(() => app.close());

describe("signup and trial (E12-2a2)", () => {
  it("opens a 7-day Growth trial with the store, ending 23:59:59 on day 7 in the store's time zone", async () => {
    const before = new Date();
    const t = (await signup("mona", { name: "Mona Trial" })).body;
    expect(t).toMatchObject({ plan: "growth", status: "active" });
    const sub = await subOf(t.id);
    expect(sub).toMatchObject({ plan_code: "growth", status: "trialing", billing_interval: "month", version: 1 });
    const local = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    expect(local.format(sub.trial_ends_at!)).toMatch(/23:59:59$/);
    const days = (Date.parse(local.format(sub.trial_ends_at!).slice(0, 10)) - Date.parse(local.format(before).slice(0, 10))) / 86_400_000;
    expect(days).toBe(6); // today is day 1
    const history = await db.tenant(t.id, (trx) => trx.selectFrom("subscription_events").select(["event", "to_status", "to_plan", "actor_type"]).execute());
    expect(history).toEqual([{ event: "start_trial", to_status: "trialing", to_plan: "growth", actor_type: "user" }]);
    const events = await db.tenant(t.id, (trx) => trx.selectFrom("domain_events").select(["type", "data"]).where("type", "like", "subscription.%").orderBy("type").execute());
    expect(events.map((e) => e.type)).toEqual(["subscription.plan_changed", "subscription.trial_started"]);
    expect(events[0]!.data).toMatchObject({ from: "free", to: "growth" });
    const created = await db.tenant(t.id, (trx) => trx.selectFrom("domain_events").select("data").where("type", "=", "tenant.created").executeTakeFirstOrThrow());
    expect(created.data).toMatchObject({ plan: "growth", trial: true });
  });

  it("takes the tier and interval asked for; an Enterprise lead tries Scale; Free only when sold publicly", async () => {
    const s = (await signup("lina", { name: "Lina Scale", plan: "scale", interval: "year" })).body;
    expect(await subOf(s.id)).toMatchObject({ plan_code: "scale", billing_interval: "year", status: "trialing" });
    const e = (await signup("sami", { name: "Sami Corp", plan: "enterprise" })).body;
    expect(e.plan).toBe("scale");
    await signup("riyad", { name: "Bad Plan", plan: "gold" }, 422);
  });

  it("creates nothing when the subscription cannot open: one transaction with the store", async () => {
    const res = await signup("riyad", { name: "Riyad Free", plan: "free" }, 422);
    expect(res.body.errors).toEqual([expect.objectContaining({ path: "plan", code: "not_offered" })]);
    const left = await db.platform((trx) => trx.selectFrom("tenants").select("id").where("name", "=", "Riyad Free").execute());
    expect(left).toEqual([]);
    await setSettings("free_tier_public = true");
    try {
      const f = (await signup("riyad", { name: "Riyad Free", plan: "free" })).body;
      expect(await subOf(f.id)).toMatchObject({ plan_code: "free", status: "active" });
    } finally {
      await setSettings("free_tier_public = false");
    }
  });

  it("one trial per owner and per phone: a second store starts on Free, and signup still succeeds", async () => {
    const again = (await signup("mona", { name: "Mona Second" })).body;
    expect(again.plan).toBe("free");
    expect(await subOf(again.id)).toMatchObject({ plan_code: "free", status: "active" });
    const audit = await db.tenant(again.id, (trx) => trx.selectFrom("audit_log").select("after").where("action", "=", "tenant.created").executeTakeFirstOrThrow());
    expect(audit.after).toMatchObject({ plan: "free", subscription: "active", trialRefused: "trial_used" });
    const samePhone = (await signup("karim", { name: "Karim Phone" })).body;
    expect(samePhone.plan).toBe("free");
    // Only peppered HMACs are kept: no phone or email in any form a store could read.
    await expect(db.tenant(again.id, (trx) => sql`SELECT * FROM trials_used`.execute(trx))).rejects.toThrow(/permission denied/);
  });

  it("one trial per shop domain: connecting a shop that already had a trial ends this store's trial into Free", async () => {
    const first = (await signup("nour", { name: "Nour Shop" })).body;
    const fresh = fake.add("hany", { uid: "fb-hany-trial", email: "hany@trial.test", emailVerified: true });
    const third = (await http().post("/v1/tenants").set(as(fresh)).send({ country: "EG", name: "Hany Shop" }).expect(201)).body;
    const connect = async (tenant: string) => {
      const c = await db.tenant(tenant, (trx) => trx.insertInto("connections").values({ tenant_id: tenant, kind: "store", provider: "shopify", external_account: "Nile-Shop.myshopify.com" })
        .onConflict((oc) => oc.columns(["tenant_id", "provider", "external_account"]).doUpdateSet({ status: "active" })).returning("id").executeTakeFirstOrThrow());
      await db.tenant(tenant, (trx) => app.get(TrialDomainConsumer).handle({
        id: crypto.randomUUID(), type: "connection.connected", tenantId: tenant, occurredAt: new Date().toISOString(), actor: null,
        entity: { type: "connection", id: c.id }, data: { provider: "shopify", kind: "store" }, version: 1,
      }, trx));
    };
    await connect(first.id);
    expect(await subOf(first.id)).toMatchObject({ status: "trialing" }); // first to bring the shop: keeps its trial
    await connect(first.id); // reconnecting its own shop changes nothing
    expect(await subOf(first.id)).toMatchObject({ status: "trialing" });
    await connect(third.id);
    expect(await subOf(third.id)).toMatchObject({ plan_code: "free", status: "active" });
    const ended = await db.tenant(third.id, (trx) => trx.selectFrom("domain_events").select("data").where("type", "=", "subscription.trial_ended").executeTakeFirstOrThrow());
    expect(ended.data).toMatchObject({ plan: "growth", outcome: "downgrade_free" });
  });

  it("with trials off (trial_days = 0) a new store starts on Free", async () => {
    await setSettings("trial_days = 0");
    try {
      const fresh = fake.add("dina", { uid: "fb-dina-trial", email: "dina@trial.test", emailVerified: true });
      const t = (await http().post("/v1/tenants").set(as(fresh)).send({ country: "SA", name: "Dina Off" }).expect(201)).body;
      expect(t.plan).toBe("free");
    } finally {
      await setSettings("trial_days = 7");
    }
  });
});

describe("stores that existed before subscriptions (D18 backfill)", () => {
  /** A store as migration 0080 leaves it: a Growth trial and a `backfill` history line, nothing in trials_used. */
  async function backfilled(token: string, shop: string | null) {
    await http().get("/v1/me").set(as(token)).expect(200); // the account, as at its last sign-in
    const uid = fake.identities.get(token)!.uid;
    const user = await db.kysely.selectFrom("users").select("id").where("firebase_uid", "=", uid).executeTakeFirstOrThrow();
    const id = crypto.randomUUID();
    await db.kysely.insertInto("tenants").values({ id, name: `Old ${token}`, slug: `old-${token}-${id.slice(0, 6)}`, plan: "growth" }).execute();
    await db.kysely.insertInto("memberships").values({ tenant_id: id, user_id: user.id, role: "owner", status: "active" }).execute();
    if (shop) await db.kysely.insertInto("connections").values({ tenant_id: id, kind: "store", provider: "shopify", external_account: shop }).execute();
    const sub = await db.kysely.insertInto("subscriptions").values({
      tenant_id: id, plan_code: "growth", status: "trialing", trial_started_at: new Date(), trial_ends_at: new Date(Date.now() + 6 * 86_400_000),
    }).returning(["id", "status", "plan_code"]).executeTakeFirstOrThrow();
    await db.kysely.insertInto("subscription_events").values({
      tenant_id: id, subscription_id: sub.id, event: "backfill", to_status: sub.status, to_plan: sub.plan_code, version: 1, actor_type: "system", data: JSON.stringify({ policy: "trial" }),
    }).execute();
    return id;
  }
  const marks = (tenant: string) => db.tenant(tenant, (trx) => trx.selectFrom("subscription_events").select(["event", "data"]).where("event", "=", "trial_keys_claimed").execute());

  it("claims the owner's and the shop's keys once, so the owner's next store starts on Free (trial_used)", async () => {
    fake.add("old", { uid: "fb-old-owner", email: "old.owner+shop1@gmail.com", emailVerified: true, phone: "+201009998877" });
    fake.add("alias", { uid: "fb-old-alias", email: "oldowner@gmail.com", emailVerified: true }); // the same mailbox, another account
    fake.add("buyer", { uid: "fb-shop-buyer", email: "buyer@trial.test", emailVerified: true });
    const old = await backfilled("old", "Old-Shop.myshopify.com");
    const scheduler = app.get(BillingScheduler);
    expect(await scheduler.claimBackfilledKeys()).toBe(1);
    expect(await scheduler.claimBackfilledKeys()).toBe(0); // never twice
    await scheduler.runOnce();
    expect(await marks(old)).toEqual([{ event: "trial_keys_claimed", data: { keys: 4, refused: 0 } }]);
    expect(await subOf(old)).toMatchObject({ plan_code: "growth", status: "trialing" }); // its own trial carries on

    const second = (await signup("old", { name: "Old Owner Second" })).body;
    expect(second.plan).toBe("free");
    const audit = await db.tenant(second.id, (trx) => trx.selectFrom("audit_log").select("after").where("action", "=", "tenant.created").executeTakeFirstOrThrow());
    expect(audit.after).toMatchObject({ plan: "free", trialRefused: "trial_used" });
    expect((await signup("alias", { name: "Alias Store" })).body.plan).toBe("free"); // a Gmail alias of the same inbox

    // Another account bringing the backfilled store's shop loses its trial at once.
    const buyer = (await signup("buyer", { name: "Buyer Store" })).body;
    const c = await db.tenant(buyer.id, (trx) => trx.insertInto("connections").values({ tenant_id: buyer.id, kind: "store", provider: "shopify", external_account: "old-shop.myshopify.com" }).returning("id").executeTakeFirstOrThrow());
    await db.tenant(buyer.id, (trx) => app.get(TrialDomainConsumer).handle({
      id: crypto.randomUUID(), type: "connection.connected", tenantId: buyer.id, occurredAt: new Date().toISOString(), actor: null,
      entity: { type: "connection", id: c.id }, data: { provider: "shopify", kind: "store" }, version: 1,
    }, trx));
    expect(await subOf(buyer.id)).toMatchObject({ plan_code: "free", status: "active" });
  });

  it("two old stores with one owner both keep their trials; the second's refused keys are noted", async () => {
    fake.add("twice", { uid: "fb-twice-owner", email: "twice@trial.test", emailVerified: true });
    const a = await backfilled("twice", null);
    const b = await backfilled("twice", null);
    expect(await app.get(BillingScheduler).claimBackfilledKeys()).toBe(2);
    const lines = [...(await marks(a)), ...(await marks(b))].map((m) => m.data);
    expect(lines).toEqual(expect.arrayContaining([{ keys: 2, refused: 0 }, { keys: 2, refused: 2 }]));
    expect(await subOf(a)).toMatchObject({ status: "trialing" });
    expect(await subOf(b)).toMatchObject({ status: "trialing" });
  });

  it("ends a trial on time even with a checkout open since the trial (incomplete)", async () => {
    const fresh = fake.add("checkout", { uid: "fb-checkout-trial", email: "checkout@trial.test", emailVerified: true });
    const t = (await http().post("/v1/tenants").set(as(fresh)).send({ country: "EG", name: "Checkout Open" }).expect(201)).body;
    const svc = app.get(SubscriptionService);
    const sub = await subOf(t.id);
    await db.tenant(t.id, (trx) => svc.transition(trx, t.id, sub.id, "checkout_open", { actor: { type: "system" } }));
    expect(await subOf(t.id)).toMatchObject({ status: "incomplete", previous_status: "trialing" });
    expect((await db.tenant(t.id, (trx) => trx.selectFrom("tenants").select("plan").executeTakeFirstOrThrow())).plan).toBe("growth");
    await app.get(BillingScheduler).runOnce(new Date(Date.now() + 8 * 86_400_000));
    expect(await subOf(t.id)).toMatchObject({ plan_code: "free", status: "active" });
    const history = await db.tenant(t.id, (trx) => trx.selectFrom("subscription_events").select(["event", "from_status", "to_status"]).orderBy("id").execute());
    expect(history.map((h) => h.event)).toEqual(["start_trial", "checkout_open", "trial_end", "start"]);
    expect(history[2]).toMatchObject({ from_status: "incomplete", to_status: "expired" });
  });
});

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { SqlStore } from "../src/sync/sql-store.js";
import { MemoryStore, type IntakeResult, type NewJob, type Store } from "../src/sync/store.js";
import { settle, setup, setupWoo } from "./fakes/setup.js";

/**
 * FX-3a: no silent webhook losses, with the providers failing a share of calls. Each case is a
 * way a webhook used to vanish: the database died between "seen" and "queued" (W1), a body
 * that could not be read was marked seen (W5), a webhook naming no resource was "accepted" (W6),
 * a dedupe key that folded two real events into one (W8: a Bosta reversal, two WooCommerce
 * updates in one second, a Shopify retry), and a disconnect that deleted queued work.
 */

/** A store whose database "dies" during intake: the transaction rolls back, nothing is saved. */
class DyingStore extends MemoryStore {
  deaths = 0;
  override async markAndEnqueue(key: string, at: number, jobs: NewJob[], now: number): Promise<IntakeResult> {
    if (this.deaths > 0) {
      this.deaths--;
      throw new Error("connection terminated unexpectedly");
    }
    return super.markAndEnqueue(key, at, jobs, now);
  }
}

const RATES = [0.1, 0.25, 0.5];

describe("webhook intake under chaos (FX-3a)", () => {
  it.each(RATES)("W1: the database dies between marking and queueing; every redelivery is processed (%s failing)", async (rate) => {
    const store = new DyingStore();
    const ctx = setup({}, store);
    const { shop, bosta, engine, clock } = ctx;
    shop.randomFaultRate = rate;
    bosta.randomFaultRate = rate;
    const orders = Array.from({ length: 12 }, () => shop.addOrder({ tags: ["mizan-confirmed"] }));
    for (const [i, o] of orders.entries()) {
      const wh = shop.webhook("orders/create", o);
      if (i % 3 === 0) {
        store.deaths = 1;
        await expect(engine.handleShopifyWebhook(wh.headers, wh.body)).rejects.toThrow(/terminated/); // Shopify gets a 5xx and retries
      }
      const r = await engine.handleShopifyWebhook(wh.headers, wh.body); // the retry, same ids
      expect(r.outcome, `order ${i}`).toBe("accepted");
      expect((await engine.handleShopifyWebhook(wh.headers, wh.body)).outcome).toBe("duplicate");
    }
    await settle(engine, store, clock);
    // No poll ran: every order shipped came in through its redelivered webhook.
    const refs = new Set([...bosta.deliveries.values()].map((d) => d.businessReference));
    for (const o of orders) expect(refs.has(o.id), o.id).toBe(true);
    expect(await store.jobs({ status: "dead" })).toEqual([]);
  });

  it("W1 on PostgreSQL: a failed enqueue rolls the mark back with it", async () => {
    const db = new PGlite();
    const s = new SqlStore(db);
    await s.migrate();
    await db.exec(`CREATE FUNCTION boom() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'disk full'; END $$;
      CREATE TRIGGER boom BEFORE INSERT ON mz_outbox FOR EACH ROW EXECUTE FUNCTION boom();`);
    const job: NewJob = { kind: "shopify.ingestOrder", connection: "shopify", payload: { orderId: "gid://shopify/Order/1" }, idempotencyKey: "shopify:order:1:evt-1" };
    await expect(s.markAndEnqueue("shopify:evt-1", 1, [job], 1)).rejects.toThrow(/disk full/);
    expect((await db.query(`SELECT key FROM mz_inbound_events`)).rows).toEqual([]); // not marked: the retry is not a "duplicate"
    await db.exec(`DROP TRIGGER boom ON mz_outbox`);
    const r = await s.markAndEnqueue("shopify:evt-1", 2, [job], 2);
    expect(r.marked).toBe(true);
    expect(r.jobs.map((j) => [j.job.kind, j.created])).toEqual([["shopify.ingestOrder", true]]);
    expect((await s.markAndEnqueue("shopify:evt-1", 3, [job], 3))).toEqual({ marked: false, jobs: [] });
    // Same job key from another delivery: marked, the existing job reported, not a second one.
    const again = await s.markAndEnqueue("shopify:evt-2", 4, [job], 4);
    expect(again.marked).toBe(true);
    expect(again.jobs.map((j) => [j.job.id, j.created])).toEqual([[r.jobs[0]!.job.id, false]]);
    expect(await s.jobs()).toHaveLength(1);
  });

  it("W5: an unreadable body is never marked, so its retry is read again", async () => {
    const { shop, engine, store, events } = setup();
    const wh = shop.webhook("orders/create", shop.addOrder());
    const broken = "{\"id\": 1,"; // cut short
    const signed = shop.webhook("orders/create", { id: "gid://shopify/Order/0" }); // borrow headers, re-sign below
    const { createHmac } = await import("node:crypto");
    const headers: Record<string, string> = { ...signed.headers, "X-Shopify-Hmac-SHA256": createHmac("sha256", shop.secret).update(broken).digest("base64") };
    const bad = await engine.handleShopifyWebhook(headers, broken);
    expect(bad).toMatchObject({ status: 200, outcome: "unparseable" });
    expect(events.some((e) => e.event === "drift" && e.data.kind === "unparseable_body")).toBe(true);
    // The same delivery id with the body intact (Shopify's retry): processed, not "duplicate".
    expect((await engine.handleShopifyWebhook({ ...wh.headers, "X-Shopify-Event-Id": headers["X-Shopify-Event-Id"]! }, wh.body)).outcome).toBe("accepted");
    expect(await store.jobs({ kind: "shopify.ingestOrder" })).toHaveLength(1);
  });

  it("W6: a webhook naming no resource is not 'accepted': drift names the paths tried, and a poll comes soon", async () => {
    const { shop, engine, store, events, clock } = setup();
    const body = JSON.stringify({ note: "no id here", updated_at: new Date(clock.now()).toISOString() });
    const { createHmac } = await import("node:crypto");
    const headers = { ...shop.webhook("orders/updated", { id: "gid://shopify/Order/0" }).headers, "X-Shopify-Hmac-SHA256": createHmac("sha256", shop.secret).update(body).digest("base64") };
    const r = await engine.handleShopifyWebhook(headers, body);
    expect(r).toMatchObject({ status: 200, outcome: "no_resource_id", body: { ignored: "no order id" } });
    expect(events.find((e) => e.event === "drift" && e.data.kind === "missing_field")?.data.detail).toBe("none of admin_graphql_api_id, id");
    const polls = await store.jobs({ kind: "shopify.pollOrders" });
    expect(polls.map((j) => j.id)).toEqual([r.nudged]);
    // A burst of them asks for one poll a minute, not one each.
    for (let i = 0; i < 5; i++) await engine.handleShopifyWebhook({ ...headers, "X-Shopify-Event-Id": `evt-noid-${i}` }, body);
    expect(await store.jobs({ kind: "shopify.pollOrders" })).toHaveLength(1);

    // Bosta: no tracking number at any path.
    const b = await engine.handleBostaWebhook({ token: "whsec-bosta" }, {}, JSON.stringify({ state: 45 }));
    expect(b).toMatchObject({ status: 200, outcome: "no_resource_id" });
    expect((await store.jobs({ kind: "bosta.pollActive" })).map((j) => j.id)).toEqual([b.nudged]);
  });

  it.each(RATES)("W8: a Bosta reversal (delivered → returned → delivered) without times is three events, a retry one (%s failing)", async (rate) => {
    const ctx = setup();
    const { shop, bosta, engine, store, clock } = ctx;
    const o = shop.addOrder({ tags: ["mizan-confirmed"] });
    const wh = shop.webhook("orders/create", o);
    await engine.handleShopifyWebhook(wh.headers, wh.body);
    await settle(engine, store, clock);
    const tn = (await store.get<{ trackingNumber: string }>("order", o.id))!.trackingNumber;
    bosta.randomFaultRate = rate;
    const outcomes: string[] = [];
    for (const [code, label] of [[45, "Delivered"], [46, "Returned to business"], [45, "Delivered"]] as const) {
      clock.advance(10 * 60_000);
      bosta.setState(tn, code, label);
      const body = bosta.webhook(tn, { noTime: true }); // the same bytes for both "delivered"
      outcomes.push((await engine.handleBostaWebhook({ token: "whsec-bosta" }, {}, body)).outcome!);
      outcomes.push((await engine.handleBostaWebhook({ token: "whsec-bosta" }, {}, body)).outcome!); // Bosta's retry
      await settle(engine, store, clock);
    }
    expect(outcomes).toEqual(["accepted", "duplicate", "accepted", "duplicate", "accepted", "duplicate"]);
    expect((await store.jobs({ kind: "bosta.ingestStatus" })).filter((j) => j.status === "done" && j.idempotencyKey.startsWith(`bosta:${tn}:`))).toHaveLength(3);
    expect(await store.jobs({ status: "dead" })).toEqual([]);
  });

  it.each(RATES)("W8: two WooCommerce updates in the same second are both read (%s failing)", async (rate) => {
    const { woo, engine, store, clock, latest } = setupWoo();
    await engine.init();
    const o = woo.addOrder({ payment: "bank" });
    const created = woo.webhook("order.created", o);
    await engine.handleWooCommerceWebhook(created.headers, created.body);
    await settle(engine, store, clock);

    clock.t = (Math.floor(clock.now() / 1000) + 1) * 1000; // the start of a second
    woo.setStatus(o.id, "on-hold");
    const first = woo.webhook("order.updated", woo.orders.get(o.id)!);
    expect((await engine.handleWooCommerceWebhook(first.headers, first.body)).outcome).toBe("accepted");
    await settle(engine, store, clock); // the first is read before the second change (no faults yet: the clock stays put)…
    clock.advance(400); // …still inside the same second: same date_modified_gmt, same delivery id
    woo.paid(o.id);
    const second = woo.webhook("order.updated", woo.orders.get(o.id)!);
    expect(second.headers["x-wc-webhook-delivery-id"]).toBe(first.headers["x-wc-webhook-delivery-id"]);
    expect(JSON.parse(second.body).date_modified_gmt).toBe(JSON.parse(first.body).date_modified_gmt);
    expect((await engine.handleWooCommerceWebhook(second.headers, second.body)).outcome).toBe("accepted");
    expect((await engine.handleWooCommerceWebhook(second.headers, second.body)).outcome).toBe("duplicate"); // the same body again
    woo.randomFaultRate = rate;
    await settle(engine, store, clock);
    expect(latest().get(String(o.id))).toMatchObject({ paymentStatus: "paid" });
  });

  it("W8: a Shopify retry with the same webhook id (no event id) is one event; a body-only delivery dedupes within the retry window", async () => {
    const { shop, engine, store, clock } = setup();
    const o = shop.addOrder();
    const wh = shop.webhook("orders/updated", o);
    const noEvent = { ...wh.headers };
    delete (noEvent as Record<string, string | undefined>)["X-Shopify-Event-Id"];
    expect((await engine.handleShopifyWebhook(noEvent, wh.body)).dedupeKey).toBe(`shopify:${wh.headers["X-Shopify-Webhook-Id"]}`);
    clock.advance(30 * 60_000);
    expect((await engine.handleShopifyWebhook(noEvent, wh.body)).outcome).toBe("duplicate");
    // A second, real update in the same second (same updated_at) under a new webhook id: its own job.
    const next = { ...noEvent, "X-Shopify-Webhook-Id": "wh-next" };
    expect((await engine.handleShopifyWebhook(next, wh.body)).outcome).toBe("accepted");
    expect(await store.jobs({ kind: "shopify.ingestOrder" })).toHaveLength(2);

    // No ids at all (never seen from Shopify, tolerated): the body, within the 4-hour retry window.
    const bare = { ...noEvent };
    delete (bare as Record<string, string | undefined>)["X-Shopify-Webhook-Id"];
    clock.t = (Math.floor(clock.now() / (4 * 3_600_000)) + 1) * 4 * 3_600_000 + 1_000; // just inside a fresh window
    expect((await engine.handleShopifyWebhook(bare, wh.body)).outcome).toBe("accepted");
    expect((await engine.handleShopifyWebhook(bare, wh.body)).outcome).toBe("duplicate");
    clock.advance(4 * 3_600_000);
    expect((await engine.handleShopifyWebhook(bare, wh.body)).outcome).toBe("accepted"); // outside the window: read again (safe: fat fetch)
  });

  it.each(RATES)("dropped, not deleted: a disconnect mid-burst keeps the queued jobs, and the reconnect's redelivery runs them (%s failing)", async (rate) => {
    const store = new MemoryStore();
    const ctx = setup({}, store);
    const { shop, bosta, engine, clock } = ctx;
    shop.randomFaultRate = rate;
    bosta.randomFaultRate = rate;
    const orders = Array.from({ length: 10 }, () => shop.addOrder({ tags: ["mizan-confirmed"] }));
    const hooks = orders.map((o) => shop.webhook("orders/create", o));
    for (const wh of hooks.slice(0, 5)) await engine.handleShopifyWebhook(wh.headers, wh.body);
    expect(await store.dropWaiting("shopify", "connection disconnected (by_team)", clock.now())).toBe(5);
    expect((await store.jobs({ status: "dropped" })).map((j) => j.lastError)).toEqual(Array(5).fill("connection disconnected (by_team)"));
    await settle(engine, store, clock); // nothing runs while disconnected
    expect(bosta.deliveries.size).toBe(0);

    // Reconnected: the store's sync asks for the same orders again (same job keys) while the burst goes on.
    for (const [i, o] of orders.slice(0, 5).entries()) {
      const r = await store.enqueue({ kind: "shopify.ingestOrder", connection: "shopify", payload: { orderId: o.id }, idempotencyKey: `shopify:order:${o.id}:${hooks[i]!.headers["X-Shopify-Event-Id"]}` }, clock.now());
      expect(r.created, "a dropped job runs again").toBe(true);
    }
    for (const wh of hooks.slice(5)) expect((await engine.handleShopifyWebhook(wh.headers, wh.body)).outcome).toBe("accepted");
    await settle(engine, store, clock);
    const refs = new Set([...bosta.deliveries.values()].map((d) => d.businessReference));
    for (const o of orders) expect(refs.has(o.id), o.id).toBe(true);
    expect(await store.jobs({ status: "dropped" })).toEqual([]);
  });

  it("a dropped job stays dropped when the run that held it ends (never back to pending or dead)", async () => {
    const db = new PGlite();
    const sql = new SqlStore(db);
    await sql.migrate();
    for (const s of [new MemoryStore(), sql] as Store[]) {
      const { job } = await s.enqueue({ kind: "bosta.createShipment", connection: "bosta", payload: {}, idempotencyKey: "ship:1" }, 1);
      await s.claimDue(1, 10, 60_000);
      if (s instanceof SqlStore) await db.query(`UPDATE mz_outbox SET status = 'dropped' WHERE id = $1`, [job.id]);
      else await (s as MemoryStore).dropWaiting("bosta", "gone", 2);
      await s.retryLater(job.id, "timeout", 5, 3);
      await s.bury(job.id, "permanent", 4);
      expect((await s.jobs()).map((j) => j.status)).toEqual(["dropped"]);
      const again = await s.enqueue({ kind: "bosta.createShipment", connection: "bosta", payload: { v: 2 }, idempotencyKey: "ship:1" }, 10);
      expect(again).toMatchObject({ created: true, job: { id: job.id, status: "pending", attempts: 0, payload: { v: 2 } } });
    }
  });
});

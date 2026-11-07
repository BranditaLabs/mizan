import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { SqlStore } from "../src/sync/sql-store.js";
import { MizanEngine } from "../src/engine/engine.js";
import { MemoryStore, type IntakeResult, type NewJob, type Store } from "../src/sync/store.js";
import { settle, setup, setupWoo } from "./fakes/setup.js";

/**
 * FX-3a: no silent webhook losses, with the providers failing a share of calls. Each case is a
 * way a webhook used to vanish: the database died between "seen" and "queued" (W1), a body
 * that could not be read was marked seen (W5), a webhook naming no resource was "accepted" (W6),
 * a dedupe key that folded two real events into one (W8: a Bosta re-delivery loop, two WooCommerce
 * updates in one second, a Shopify retry), and a disconnect that deleted queued work.
 */

/**
 * A store whose database "dies" in the middle of intake: after MemoryStore.markAndEnqueue has set
 * the inbound key, while it queues the job. The real implementation must take the mark back.
 */
class DyingStore extends MemoryStore {
  deaths = 0;
  /** Deaths that happened with the key already marked (so the unmark path really ran). */
  diedMarked = 0;
  private intakeKey: string | undefined;
  override async markAndEnqueue(key: string, at: number, jobs: NewJob[], now: number): Promise<IntakeResult> {
    this.intakeKey = key;
    try {
      return await super.markAndEnqueue(key, at, jobs, now);
    } finally {
      this.intakeKey = undefined;
    }
  }
  override async enqueue<P>(j: NewJob<P>, now: number) {
    if (this.deaths > 0 && this.intakeKey) {
      this.deaths--;
      if ((this as unknown as { inbound: Map<string, number> }).inbound.has(this.intakeKey)) this.diedMarked++;
      throw new Error("connection terminated unexpectedly");
    }
    return super.enqueue(j, now);
  }
}

/** W1 on PostgreSQL: the next intake insert into the outbox fails (a trigger), after the mark in the same statement. */
async function dyingSql() {
  const db = new PGlite();
  const store = new SqlStore(db);
  await store.migrate();
  await db.exec(`CREATE FUNCTION boom() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'connection terminated unexpectedly'; END $$;`);
  return {
    db, store,
    die: () => db.exec(`CREATE TRIGGER boom BEFORE INSERT ON mz_outbox FOR EACH ROW WHEN (NEW.kind = 'shopify.ingestOrder') EXECUTE FUNCTION boom();`),
    live: () => db.exec(`DROP TRIGGER IF EXISTS boom ON mz_outbox`),
  };
}

const RATES = [0.1, 0.25, 0.5];

/** Bosta deliveries per order: exactly one each, never a second shipment for a retried or revived booking. */
const shipmentsPerOrder = (bosta: { deliveries: Map<string, { businessReference?: string }> }) => {
  const n = new Map<string, number>();
  for (const d of bosta.deliveries.values()) if (d.businessReference) n.set(d.businessReference, (n.get(d.businessReference) ?? 0) + 1);
  return n;
};

describe("webhook intake under chaos (FX-3a)", () => {
  /** Deliveries every third of which dies mid-intake; each redelivery must be accepted, then shipped once. */
  async function w1(store: Store, rate: number, n: number, die: () => Promise<unknown>, live: () => Promise<unknown>) {
    const { shop, bosta, engine, clock } = setup({}, store);
    shop.randomFaultRate = rate;
    bosta.randomFaultRate = rate;
    const orders = Array.from({ length: n }, () => shop.addOrder({ tags: ["mizan-confirmed"] }));
    for (const [i, o] of orders.entries()) {
      const wh = shop.webhook("orders/create", o);
      if (i % 3 === 0) {
        await die();
        await expect(engine.handleShopifyWebhook(wh.headers, wh.body)).rejects.toThrow(/terminated/); // Shopify gets a 5xx and retries
        await live();
      }
      const r = await engine.handleShopifyWebhook(wh.headers, wh.body); // the retry, same ids
      expect(r.outcome, `order ${i}`).toBe("accepted"); // the store took its mark back
      expect((await engine.handleShopifyWebhook(wh.headers, wh.body)).outcome).toBe("duplicate");
    }
    await settle(engine, store, clock);
    // No poll ran: every order shipped came in through its redelivered webhook, once.
    const shipped = shipmentsPerOrder(bosta);
    for (const o of orders) expect(shipped.get(o.id), o.id).toBe(1);
    expect(bosta.deliveries.size).toBe(orders.length);
    expect(await store.jobs({ status: "dead" })).toEqual([]);
  }

  it.each(RATES)("W1: the database dies between marking and queueing; every redelivery is processed (%s failing)", async (rate) => {
    const store = new DyingStore();
    await w1(store, rate, 12, async () => { store.deaths = 1; }, async () => {});
    expect(store.deaths).toBe(0);
    expect(store.diedMarked).toBe(4); // every death came after the mark: MemoryStore's unmark is what made the retry "accepted"
  });

  it("W1 on PostgreSQL under chaos: a delivery that dies inside the intake statement is accepted on redelivery (0.25 failing)", async () => {
    const { store, die, live } = await dyingSql();
    await w1(store, 0.25, 6, die, live);
  }, 120_000);

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

  it("W1 in memory: two identical deliveries at once are one accepted and one duplicate; a failed enqueue unmarks", async () => {
    const store = new MemoryStore();
    const job: NewJob = { kind: "shopify.ingestOrder", connection: "shopify", payload: {}, idempotencyKey: "shopify:order:1:evt-1" };
    const both = await Promise.all([store.markAndEnqueue("shopify:evt-1", 1, [job], 1), store.markAndEnqueue("shopify:evt-1", 1, [job], 1)]);
    expect(both.map((r) => r.marked).sort()).toEqual([false, true]);
    expect(await store.jobs()).toHaveLength(1);
    // A store that fails mid-intake: the key is not left marked, so the provider's retry is processed.
    const failing = new MemoryStore();
    const enqueue = failing.enqueue.bind(failing);
    let fail = true;
    failing.enqueue = (async (j, now) => { if (fail) { fail = false; throw new Error("out of memory"); } return enqueue(j, now); }) as MemoryStore["enqueue"];
    await expect(failing.markAndEnqueue("shopify:evt-2", 1, [job], 1)).rejects.toThrow(/out of memory/);
    expect((await failing.markAndEnqueue("shopify:evt-2", 2, [job], 2)).marked).toBe(true);
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
    clock.t = (Math.floor(clock.now() / 60_000) + 1) * 60_000 + 5_000; // 12:00:05
    const body = JSON.stringify({ note: "no id here", updated_at: new Date(clock.now()).toISOString() });
    const { createHmac } = await import("node:crypto");
    const headers = { ...shop.webhook("orders/updated", { id: "gid://shopify/Order/0" }).headers, "X-Shopify-Hmac-SHA256": createHmac("sha256", shop.secret).update(body).digest("base64") };
    const r = await engine.handleShopifyWebhook(headers, body);
    expect(r).toMatchObject({ status: 200, outcome: "no_resource_id", body: { ignored: "no order id" } });
    expect(events.find((e) => e.event === "drift" && e.data.kind === "missing_field")?.data.detail).toBe("none of admin_graphql_api_id, id");
    const polls = await store.jobs({ kind: "shopify.pollOrders" });
    expect(polls.map((j) => j.id)).toEqual([r.nudged]);
    // A burst of them asks for one poll a minute, not one each: it waits for the minute's end, so it runs after all of them.
    const boundary = (Math.floor(clock.now() / 60_000) + 1) * 60_000;
    expect(polls[0]!.nextAttemptAt).toBe(boundary);
    await engine.drain(); // not due yet: nothing runs mid-minute
    clock.advance(35_000); // 12:00:40, the same minute: the poll it shares has not run, so it covers this one too
    const sameMinute = await engine.handleShopifyWebhook({ ...headers, "X-Shopify-Event-Id": "evt-noid-40s" }, body);
    expect(sameMinute.nudged).toBe(r.nudged);
    expect((await store.jobs({ kind: "shopify.pollOrders", status: "pending" })).map((j) => j.id)).toEqual([r.nudged]);
    for (let i = 0; i < 5; i++) await engine.handleShopifyWebhook({ ...headers, "X-Shopify-Event-Id": `evt-noid-${i}` }, body);
    expect(await store.jobs({ kind: "shopify.pollOrders" })).toHaveLength(1);
    const lastAt = clock.now();
    await settle(engine, store, clock);
    const ran = (await store.jobs({ kind: "shopify.pollOrders" }))[0]!;
    expect(ran).toMatchObject({ id: r.nudged, status: "done" });
    expect(ran.updatedAt).toBeGreaterThan(lastAt); // the poll ran after the last webhook of its minute
    // A webhook arriving after that poll ran (its minute) gets a poll of its own, not the finished one.
    const late = await engine.handleShopifyWebhook({ ...headers, "X-Shopify-Event-Id": "evt-noid-late" }, body);
    expect(late.nudged).not.toBe(r.nudged);
    expect((await store.jobs({ kind: "shopify.pollOrders", status: "pending" })).map((j) => j.id)).toEqual([late.nudged]);

    // Bosta: no tracking number at any path.
    const b = await engine.handleBostaWebhook({ token: "whsec-bosta" }, {}, JSON.stringify({ state: 45 }));
    expect(b).toMatchObject({ status: 200, outcome: "no_resource_id" });
    expect((await store.jobs({ kind: "bosta.pollActive" })).map((j) => j.id)).toEqual([b.nudged]);
  });

  /** A booked shipment and a way to read its status (the engine's shipment record). */
  async function booked(ctx: ReturnType<typeof setup>) {
    const { shop, engine, store, clock } = ctx;
    const o = shop.addOrder({ tags: ["mizan-confirmed"] });
    const wh = shop.webhook("orders/create", o);
    await engine.handleShopifyWebhook(wh.headers, wh.body);
    await settle(engine, store, clock);
    const tn = (await store.get<{ trackingNumber: string }>("order", o.id))!.trackingNumber;
    return { tn, status: async () => (await store.get<{ shipment: { status: string } }>("shipment", tn))!.shipment.status };
  }
  /** Bosta's re-delivery loop: back out for delivery after a failed attempt (a change the engine applies, unlike one after delivered). */
  const LOOP = [[41, "Out for delivery", "out_for_delivery"], [47, "Customer not available", "failed_attempt"], [41, "Out for delivery", "out_for_delivery"]] as const;

  it.each(RATES)("W8: a Bosta re-delivery loop (out for delivery → not available → out for delivery) without times is three events, each applied; a retry is one (%s failing)", async (rate) => {
    const ctx = setup();
    const { bosta, engine, store, clock } = ctx;
    const { tn, status } = await booked(ctx);
    bosta.randomFaultRate = rate;
    const outcomes: string[] = [];
    const statuses: string[] = [];
    for (const [code, label] of LOOP) {
      clock.advance(10 * 60_000);
      bosta.setState(tn, code, label);
      const body = bosta.webhook(tn, { noTime: true }); // the same bytes for both "out for delivery"
      outcomes.push((await engine.handleBostaWebhook({ token: "whsec-bosta" }, {}, body)).outcome!);
      outcomes.push((await engine.handleBostaWebhook({ token: "whsec-bosta" }, {}, body)).outcome!); // Bosta's retry
      await settle(engine, store, clock);
      statuses.push(await status());
    }
    expect(outcomes).toEqual(["accepted", "duplicate", "accepted", "duplicate", "accepted", "duplicate"]);
    expect(statuses).toEqual(LOOP.map(([, , s]) => s)); // each event's effect got through, not only its job
    expect(await store.jobs({ status: "dead" })).toEqual([]);
  });

  it("W8: the same loop inside one 2-minute retry window is still three events: the key names the shipment's previous webhook", async () => {
    // The third body has the same bytes and the same retry window as the first. Keyed by the body
    // and the window alone it was folded into the first (a "duplicate") and the status stayed at
    // failed_attempt until the next poll of active shipments; now it is applied at once.
    const ctx = setup();
    const { bosta, engine, store, clock } = ctx;
    const { tn, status } = await booked(ctx);
    clock.t = (Math.floor(clock.now() / 120_000) + 1) * 120_000 + 1_000; // the start of a retry window
    const start = clock.now();
    const outcomes: string[] = [];
    const statuses: string[] = [];
    for (const [code, label] of LOOP) {
      clock.advance(5_000);
      bosta.setState(tn, code, label);
      const body = bosta.webhook(tn, { noTime: true });
      outcomes.push((await engine.handleBostaWebhook({ token: "whsec-bosta" }, {}, body)).outcome!);
      outcomes.push((await engine.handleBostaWebhook({ token: "whsec-bosta" }, {}, body)).outcome!); // Bosta's retry: still one
      await settle(engine, store, clock);
      statuses.push(await status());
    }
    expect(Math.floor(clock.now() / 120_000)).toBe(Math.floor(start / 120_000)); // all inside one window
    expect(outcomes).toEqual(["accepted", "duplicate", "accepted", "duplicate", "accepted", "duplicate"]);
    expect(statuses).toEqual(["out_for_delivery", "failed_attempt", "out_for_delivery"]);
    const ingests = (await store.jobs({ kind: "bosta.ingestStatus" })).filter((j) => j.idempotencyKey.startsWith(`bosta:${tn}:`));
    expect(ingests.map((j) => j.status)).toEqual(["done", "done", "done"]);
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
    const r1 = await engine.handleWooCommerceWebhook(first.headers, first.body);
    expect(r1.outcome).toBe("accepted");
    await settle(engine, store, clock); // the first is read before the second change (no faults yet: the clock stays put)…
    clock.advance(400); // …still inside the same second: same date_modified_gmt, same delivery id
    woo.paid(o.id);
    const second = woo.webhook("order.updated", woo.orders.get(o.id)!);
    expect(second.headers["x-wc-webhook-delivery-id"]).toBe(first.headers["x-wc-webhook-delivery-id"]);
    expect(JSON.parse(second.body).date_modified_gmt).toBe(JSON.parse(first.body).date_modified_gmt);
    const r2 = await engine.handleWooCommerceWebhook(second.headers, second.body);
    expect(r2.outcome).toBe("accepted");
    expect((await engine.handleWooCommerceWebhook(second.headers, second.body)).outcome).toBe("duplicate"); // the same body again
    woo.randomFaultRate = rate;
    await settle(engine, store, clock);
    expect(latest().get(String(o.id))).toMatchObject({ paymentStatus: "paid" });
    // Two reads of the order for the two updates, both done; nothing gave up.
    const updates = [...r1.jobIds!, ...r2.jobIds!];
    expect(new Set(updates).size).toBe(2);
    const done = (await store.jobs({ kind: "woocommerce.ingestOrder", status: "done" })).filter((j) => updates.includes(j.id));
    expect(done).toHaveLength(2);
    expect(await store.jobs({ status: "dead" })).toEqual([]);
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

  it.each(RATES)("dropped, not deleted: a disconnect mid-burst keeps the queued jobs, and the reconnect's import brings every order in, shipped once (%s failing)", async (rate) => {
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
    // Shopify does not resend a webhook it had a 200 for, and a resend would be a duplicate (the key stays marked).
    expect((await engine.handleShopifyWebhook(hooks[0]!.headers, hooks[0]!.body)).outcome).toBe("duplicate");

    // Reconnected: what production does (apps/api connections/import.ts) is an import of the store's
    // recent orders, under its own keys, while the burst goes on.
    await store.enqueue(MizanEngine.shopifyBackfillJob("reconnect-1", clock.now() - 60 * 86_400_000, clock.now()), clock.now());
    for (const wh of hooks.slice(5)) expect((await engine.handleShopifyWebhook(wh.headers, wh.body)).outcome).toBe("accepted");
    await settle(engine, store, clock);
    const shipped = shipmentsPerOrder(bosta);
    for (const o of orders) expect(shipped.get(o.id), o.id).toBe(1);
    expect(bosta.deliveries.size).toBe(orders.length);
    expect(await store.jobs({ status: "dead" })).toEqual([]);
    // The dropped webhook jobs stay dropped (support sees what the disconnect stopped); their orders came in by the import.
    expect(await store.jobs({ status: "dropped" })).toHaveLength(5);
  });

  it.each(RATES)("a booking dropped with a Bosta disconnect is revived by its own key when the order is read again, and ships once (%s failing)", async (rate) => {
    const store = new MemoryStore();
    const { shop, bosta, engine, clock } = setup({}, store);
    const orders = Array.from({ length: 6 }, () => shop.addOrder({ tags: ["mizan-confirmed"] }));
    for (const o of orders) {
      const wh = shop.webhook("orders/create", o);
      await engine.handleShopifyWebhook(wh.headers, wh.body);
    }
    for (let i = 0; i < 1000; i++) bosta.faults.push({ path: "deliveries", fault: "500" }); // Bosta down: the bookings wait to retry
    await engine.drain();
    const waiting = await store.jobs({ kind: "bosta.createShipment", status: "pending" });
    expect(waiting.map((j) => j.idempotencyKey).sort()).toEqual(orders.map((o) => `ship:${o.id}`).sort());
    expect(await store.dropWaiting("bosta", "connection disconnected (by_team)", clock.now())).toBe(orders.length);
    bosta.faults.length = 0;
    await settle(engine, store, clock);
    expect(bosta.deliveries.size).toBe(0); // nothing books while disconnected

    // Reconnected: the import reads the orders again; each still unshipped asks for `ship:{orderId}` again.
    shop.randomFaultRate = rate;
    bosta.randomFaultRate = rate;
    await store.enqueue(MizanEngine.shopifyBackfillJob("reconnect-2", clock.now() - 60 * 86_400_000, clock.now()), clock.now());
    await settle(engine, store, clock);
    const ships = await store.jobs({ kind: "bosta.createShipment" });
    expect(ships.map((j) => [j.idempotencyKey, j.status]).sort()).toEqual(orders.map((o) => [`ship:${o.id}`, "done"]).sort()); // the same rows, revived
    const shipped = shipmentsPerOrder(bosta);
    for (const o of orders) expect(shipped.get(o.id), o.id).toBe(1);
    expect(bosta.deliveries.size).toBe(orders.length);
    expect(await store.jobs({ status: "dead" })).toEqual([]);
  });

  it.each(["complete", "retryLater", "bury"] as const)("a job dropped while it ran, then revived by its key: the old run's %s changes nothing, and the revived job runs once after the lease", async (end) => {
    const db = new PGlite();
    const sql = new SqlStore(db);
    await sql.migrate();
    for (const s of [new MemoryStore(), sql] as Store[]) {
      const finish = (id: string, at: number) =>
        end === "complete" ? s.complete(id, at) : end === "retryLater" ? s.retryLater(id, "timeout", at + 1_000, at) : s.bury(id, "permanent", at);
      const { job } = await s.enqueue({ kind: "bosta.createShipment", connection: "bosta", payload: {}, idempotencyKey: "ship:1" }, 1);
      expect(await s.claimDue(1, 10, 60_000)).toHaveLength(1); // the old run holds it until 60_001
      if (s instanceof SqlStore) await db.query(`UPDATE mz_outbox SET status = 'dropped' WHERE id = $1`, [job.id]); // as ConnectionLifecycle: lease kept
      else await (s as MemoryStore).dropWaiting("bosta", "gone", 2);
      // Asked for again before the old run's lease (60 s from t=1) is over: revived, but due only once it is.
      const again = await s.enqueue({ kind: "bosta.createShipment", connection: "bosta", payload: { v: 2 }, idempotencyKey: "ship:1" }, 10);
      expect(again).toMatchObject({ created: true, job: { id: job.id, status: "pending", attempts: 0, payload: { v: 2 }, nextAttemptAt: 60_001 } });
      expect(await s.claimDue(30_000, 10, 60_000)).toEqual([]); // no second run beside the old one
      await finish(job.id, 40_000); // the old run ends now, with the job revived
      expect((await s.jobs()).map((j) => [j.status, j.attempts, j.nextAttemptAt])).toEqual([["pending", 0, 60_001]]);
      const [run] = await s.claimDue(60_001, 10, 60_000);
      expect(run).toMatchObject({ id: job.id, attempts: 1 });
      expect(await s.claimDue(60_002, 10, 60_000)).toEqual([]); // once
      await s.complete(job.id, 60_002);
      expect((await s.jobs()).map((j) => j.status)).toEqual(["done"]);
      expect(await s.claimDue(500_000, 10, 60_000)).toEqual([]);
    }
  });

  it("a dropped job stays dropped when the run that held it ends; revived, it waits out the old lease and the old run cannot end it", async () => {
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
      await s.complete(job.id, 4);
      expect((await s.jobs()).map((j) => j.status)).toEqual(["dropped"]);
      // Asked for again before the old run's lease (60 s from t=1) is over: revived, but due only once it is.
      const again = await s.enqueue({ kind: "bosta.createShipment", connection: "bosta", payload: { v: 2 }, idempotencyKey: "ship:1" }, 10);
      expect(again).toMatchObject({ created: true, job: { id: job.id, status: "pending", attempts: 0, payload: { v: 2 }, nextAttemptAt: 60_001 } });
      expect(await s.claimDue(30_000, 10, 60_000)).toEqual([]); // no second run beside the old one
      // The old run ends now: it neither completes, retries nor buries the revived job.
      await s.complete(job.id, 40_000);
      await s.retryLater(job.id, "timeout", 50_000, 40_000);
      await s.bury(job.id, "permanent", 40_000);
      expect((await s.jobs()).map((j) => [j.status, j.attempts])).toEqual([["pending", 0]]);
      const [run] = await s.claimDue(60_001, 10, 60_000);
      expect(run).toMatchObject({ id: job.id, attempts: 1 });
      await s.complete(job.id, 60_002);
      expect((await s.jobs()).map((j) => j.status)).toEqual(["done"]);
    }
  });
});

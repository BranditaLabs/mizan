import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import { asWorker, trxQueryClient, type DB } from "@mizan/db";
import { MizanEngine, SqlStore } from "@mizan/engine";
import type { ShipmentStatus } from "@mizan/shared";
import { APP_CONFIG, runsWorkerInProcess, type AppConfig } from "../platform/config.js";
import { Database } from "../platform/db/database.js";
import { EventsService } from "../platform/events/events.service.js";
import { ModuleRef } from "@nestjs/core";
import { COPY_SNAPSHOT_VERSION } from "../modules/orders/order-projector.js";
import { STORE_ORDERS, type StoreOrderSink } from "../modules/orders/ports.js";
import { NotConnectedError } from "./connection-resolver.js";
import { ENGINE_RUNTIME, EngineRegistry, type RuntimeFactory } from "./engine-registry.js";
import { storeSyncOf } from "./store-sync-options.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
export const GUARD = {
  // Without the store's order webhooks (until the app's customer data access is approved) this is how fast a change in Shopify arrives.
  tickMs: 2 * MIN,
  /** Brought back at most this many times, this long after it died each time. */
  revivalDelays: [HOUR, 6 * HOUR, 24 * HOUR] as const,
  /** Older than this is left alone: done jobs are kept 7 days, so a re-asserted write never repeats one already made. */
  windowMs: 3 * 24 * HOUR,
  /** A booking with no answer this long is looked at. */
  stuckBookingMs: 30 * MIN,
};
/** Trouble that passes: worth another try later. The rest (validation, auth, permission…) needs a person. */
// "no handler for job kind": a job queued by new code and claimed by an old worker during a deploy; the next worker knows it.
const RETRYABLE = /^(gave up after \d+ attempts — (rate_limited|transient|timeout|circuit_open|conflict)|rate_limited|transient|timeout|circuit_open|conflict|no handler for job kind)/;
const COLLECTS_ON_DELIVERY = new Set(["cod", "partial"]);
/** The copy repair's version: a new one walks every copy again. */
const COPY_REPAIR = "u26";
const TERMINAL_FOR_STORE = new Set<ShipmentStatus>(["delivered", "returned", "lost"]);

/** When the guardian will bring a dead job back on its own (engine-clock ms), or null when it needs a person. */
export function autoRetryAt(lastError: string | null, revivals: number, diedAt: number): number | null {
  if (!lastError || revivals >= GUARD.revivalDelays.length || !RETRYABLE.test(lastError)) return null;
  return diedAt + GUARD.revivalDelays[revivals]!;
}

/** What the guardian keeps per store (engine record "guardian/round"). */
export interface GuardRound { at: string }

export interface GuardStats { stores: number; polled: number; revivedJobs: number; revivedEvents: number; rebooked: number; reasserted: number; failed: number }

/**
 * The sync guardian (two-way delivery, recovery). Every 2 minutes, in the worker:
 * 1. Polls: each store's engine looks again at what webhooks may have dropped — Shopify or
 *    WooCommerce orders changed since its last look, every Bosta shipment still moving, and
 *    (hourly) the webhook subscriptions themselves.
 * 2. Revives: jobs and events that died of trouble that passes (rate limits, timeouts, a provider
 *    down) run again, up to three times, an hour, six and a day after they died.
 * 3. Unsticks: a Bosta booking with no answer after 30 minutes and no job behind it is asked again
 *    (the engine looks the reference up first: adopted, never booked twice).
 * 4. Re-asserts: for the last three days, every write the store should have had from Mizan's state
 *    (the fulfillment with its tracking, the courier's final step, paid on delivery, the return or
 *    lost tag, a cancel) is queued under its usual key: a no-op when it was made, the missing step
 *    when a crash lost it.
 * Each store is handled on its own: one that fails is logged and the others go on.
 */
@Injectable()
export class SyncGuardian implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger("SyncGuardian");
  private timer?: NodeJS.Timeout;
  private running?: Promise<unknown>;

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(EngineRegistry) private readonly registry: EngineRegistry,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(ENGINE_RUNTIME) private readonly runtime: RuntimeFactory,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(ModuleRef) private readonly moduleRef: ModuleRef,
  ) {}

  /** Orders made in Mizan, copied to the store (the orders module): resolved when first needed. */
  private get storeOrders(): StoreOrderSink | undefined {
    try { return this.moduleRef.get<StoreOrderSink>(STORE_ORDERS, { strict: false }); } catch { return undefined; }
  }

  onApplicationBootstrap(): void {
    if (runsWorkerInProcess(this.config)) this.start();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
  }

  start(): void {
    if (this.timer) return;
    const tick = () => {
      if (this.running) return; // the last round is still going
      this.running = this.round().catch((err) => this.logger.error({ err }, "sync guardian round failed")).finally(() => { this.running = undefined; });
    };
    this.timer = setInterval(tick, GUARD.tickMs);
    this.timer.unref();
    setTimeout(tick, 30_000).unref();
  }

  /** One round over every connected store. `jobNow` is the engine's clock (job times); `now` the database's. */
  async round(now = Date.now(), jobNow = now): Promise<GuardStats> {
    const stats: GuardStats = { stores: 0, polled: 0, revivedJobs: 0, revivedEvents: 0, rebooked: 0, reasserted: 0, failed: 0 };
    const revived = await this.revive(jobNow);
    stats.revivedJobs = revived.jobs;
    stats.revivedEvents = revived.events;
    const stores = await this.db.worker((trx) => trx.selectFrom("connections").select(["id", "tenant_id", "provider"])
      .where("kind", "=", "store").where("provider", "in", ["shopify", "woocommerce"]).where("status", "!=", "disconnected").execute());
    for (const s of stores) {
      stats.stores++;
      try {
        const { engine } = await this.registry.get(s.tenant_id, s.id);
        await engine.scheduleReconcile(GUARD.tickMs);
        stats.polled++;
        const r = await this.db.tenant(s.tenant_id, (trx) => this.repair(trx, s.tenant_id, s.id, s.provider, now));
        stats.rebooked += r.rebooked;
        stats.reasserted += r.reasserted;
      } catch (err) {
        if (!(err instanceof NotConnectedError)) {
          stats.failed++;
          this.logger.error({ err, tenantId: s.tenant_id, store: s.id }, "sync guardian: store skipped this round");
        }
      }
    }
    if (stats.revivedJobs || stats.revivedEvents || stats.rebooked || stats.reasserted || stats.failed) this.logger.log({ ...stats }, "sync guardian recovered");
    return stats;
  }

  /** Dead jobs and events that died of passing trouble, brought back (capped, spaced). */
  async revive(now = Date.now()): Promise<{ jobs: number; events: number }> { // `now` on the engine's clock, as job times are
    const [d1, d2, d3] = GUARD.revivalDelays;
    return asWorker(this.db.kysely, async (trx) => {
      const jobs = await sql<{ id: string; tenant_id: string; kind: string; revivals: number }>`
        UPDATE mz_outbox o SET status = 'pending', attempts = 0, next_attempt_at = ${now}, updated_at = ${now}, revivals = revivals + 1
        WHERE o.status = 'dead' AND o.revivals < 3 AND o.updated_at > ${now - 7 * 24 * HOUR}
          AND o.updated_at < ${now} - (CASE o.revivals WHEN 0 THEN ${d1}::bigint WHEN 1 THEN ${d2}::bigint ELSE ${d3}::bigint END)
          AND o.last_error ~ ${RETRYABLE.source}
          AND NOT EXISTS (SELECT 1 FROM connections c WHERE c.id::text = o.scope AND c.status = 'disconnected')
        RETURNING o.id, o.tenant_id, o.kind, o.revivals`.execute(trx);
      const events = await sql<{ id: string }>`
        UPDATE domain_events SET dead_at = NULL, attempts = 0, next_attempt_at = now(), locked_until = NULL, revivals = revivals + 1
        WHERE dead_at IS NOT NULL AND revivals < 3 AND occurred_at > now() - interval '7 days'
          AND dead_at < now() - (CASE revivals WHEN 0 THEN interval '1 hour' WHEN 1 THEN interval '6 hours' ELSE interval '24 hours' END)
        RETURNING id`.execute(trx);
      for (const j of jobs.rows) this.logger.warn({ tenantId: j.tenant_id, kind: j.kind, revival: j.revivals }, "dead job brought back");
      return { jobs: jobs.rows.length, events: events.rows.length };
    });
  }

  /** A store's bookings with no answer, and the writes the store should have had, queued again under their keys. */
  async repair(trx: Transaction<DB>, tenantId: string, storeId: string, provider: string, now = Date.now()): Promise<{ rebooked: number; reasserted: number }> {
    const since = new Date(now - GUARD.windowMs);
    const clock = this.runtime(tenantId).clock.now();
    const conn = await trx.selectFrom("connections").select("config").where("id", "=", storeId).executeTakeFirstOrThrow();
    const sync = storeSyncOf(conn.config as Record<string, unknown> | null);
    const engineQueue = (connections: Record<string, string>) => new SqlStore(trxQueryClient(trx), { tenantId, store: storeId, connections });
    let rebooked = 0;
    let reasserted = 0;
    const count = (r: { created: boolean }) => { if (r.created) reasserted++; };

    // Bookings with no answer and no job behind them in any store's queue (a job lost with a crash): queued again
    // where the booking would have queued it, so nothing runs twice; the engine looks Bosta up first anyway.
    const stuck = await trx.selectFrom("shipments as s").innerJoin("connections as k", "k.id", "s.connection_id").innerJoin("orders as o", "o.id", "s.order_id")
      .leftJoin("connections as c", "c.id", "o.connection_id")
      .select(["s.id", "s.order_id", "s.connection_id", "o.external_id", "o.connection_id as order_store", "c.provider as store_provider", "c.status as store_status", "o.store_copy_connection_id", "o.store_copy_id"])
      .where("s.booking", "=", "pending").where("k.provider", "=", "bosta")
      .where("s.created_at", "<", new Date(now - GUARD.stuckBookingMs)).where("s.created_at", ">", since).execute();
    if (stuck.length) {
      const first = (await trx.selectFrom("connections").select("id").where("kind", "=", "store").where("provider", "in", ["shopify", "woocommerce"])
        .where("status", "!=", "disconnected").orderBy("created_at").executeTakeFirst())?.id;
      // A job counts only where it can run: one left in a disconnected store's queue never will.
      const queued = new Set((await trx.selectFrom("mz_outbox as j").leftJoin("connections as q", (jn) => jn.on(sql<boolean>`q.id::text = j.scope`))
        .select("j.idempotency_key").where("j.idempotency_key", "in", stuck.map((s) => `bosta:ship:${s.id}`))
        .where((w) => w.or([w("q.id", "is", null), w("q.status", "!=", "disconnected")])).execute()).map((r) => r.idempotency_key));
      for (const s of stuck) {
        if (queued.has(`bosta:ship:${s.id}`)) continue; // a job exists (running, retrying, or dead and revived on its own)
        // The store book() picks: the order's own store, else its copy's store, else the tenant's first.
        const own = s.order_store && s.store_status !== "disconnected" ? s.order_store : null;
        const copyHome = s.store_copy_id && s.store_copy_connection_id && (await trx.selectFrom("connections").select("status").where("id", "=", s.store_copy_connection_id).executeTakeFirst())?.status !== "disconnected" ? s.store_copy_connection_id : null;
        const home = own ?? copyHome ?? first;
        if (home !== storeId) continue;
        const storeOrderId = own ? (s.store_provider === "shopify" ? s.external_id : null) : copyHome ? s.store_copy_id : null;
        const r = await engineQueue({ bosta: s.connection_id }).enqueue(MizanEngine.bostaShipJob({ shipmentId: s.id, orderId: s.order_id, ...(storeOrderId ? { storeOrderId } : {}) }), clock);
        if (r.created) rebooked++;
      }
    }

    if (provider === "shopify") {
      const shopify = engineQueue({ shopify: storeId });
      // Shipments of this store's orders: the fulfillment with its tracking, and a final step's writes.
      const shipped = await trx.selectFrom("shipments as s").innerJoin("orders as o", "o.id", "s.order_id").innerJoin("connections as k", "k.id", "s.connection_id")
        .select(["s.tracking_number", "s.tracking_url", "s.status", "s.status_at", "s.provider", "s.external_id as shipment_ref", "k.provider as courier", "o.payment_mode",
          sql<string>`case when o.connection_id is not null then o.external_id else o.store_copy_id end`.as("external_id")])
        .where((w) => w.or([w.and([w("o.connection_id", "=", storeId), w("o.external_id", "is not", null)]), w.and([w("o.store_copy_connection_id", "=", storeId), w("o.store_copy_id", "is not", null)])]))
        .where("s.booking", "=", "booked").where("s.is_return_leg", "=", false)
        .where("s.tracking_number", "is not", null).where("s.updated_at", ">", since).execute();
      for (const s of shipped) {
        const tn = s.tracking_number!;
        const ext = s.external_id!;
        if (s.shipment_ref?.startsWith("gid://shopify/Fulfillment/")) continue; // it came from the store
        count(await shopify.enqueue(MizanEngine.shopifyFulfillJob({ orderId: ext, trackingNumber: tn, ...(s.courier === "manual" ? { company: s.provider, ...(s.tracking_url ? { url: s.tracking_url } : {}) } : {}) }), clock));
        const status = s.status as ShipmentStatus;
        if (!TERMINAL_FOR_STORE.has(status)) continue;
        if (sync.progressEvents) {
          const job = MizanEngine.shopifyProgressJob(ext, tn, status, (s.status_at ?? new Date(now)).toISOString());
          if (job) count(await shopify.enqueue(job, clock));
        }
        if (status === "delivered" && sync.markPaidOnDelivery && COLLECTS_ON_DELIVERY.has(s.payment_mode)) count(await shopify.enqueue(MizanEngine.shopifyMarkPaidJob(ext), clock));
        const tag = status === "returned" && sync.tagReturned ? "mizan-returned" : status === "lost" && sync.tagLost ? "mizan-lost" : null;
        if (tag) count(await shopify.enqueue(MizanEngine.shopifyTagJob(ext, [tag], tn), clock));
      }
    }

    // Cancelled in Mizan (not by the store): the store's order cancelled too.
    const cancelled = await trx.selectFrom("orders as o").innerJoin("domain_events as e", (j) => j.onRef("e.entity_id", "=", "o.id").on("e.type", "=", "order.cancelled"))
      .select([sql<string>`case when o.connection_id is not null then o.external_id else o.store_copy_id end`.as("external_id"), sql<string>`e.data->>'reason'`.as("reason"), "o.connection_id as own_store", "o.paid_minor"])
      .where((w) => w.or([w.and([w("o.connection_id", "=", storeId), w("o.external_id", "is not", null)]), w.and([w("o.store_copy_connection_id", "=", storeId), w("o.store_copy_id", "is not", null)])]))
      .where("o.status", "=", "cancelled")
      .where("o.cancelled_at", ">", since).execute();
    for (const c of cancelled) {
      if (c.reason === "cancelled_in_store") continue; // from the store
      if (c.reason === "duplicate" && (c.own_store || BigInt(c.paid_minor) > 0n)) continue; // the duplicates decision's own; never a paid one
      if (provider === "shopify") {
        const store = new SqlStore(trxQueryClient(trx), { tenantId, connections: { shopify: storeId } }); // the cancel's own queue (bulk, duplicates)
        count(await store.enqueue(MizanEngine.shopifyCancelJob({ orderId: c.external_id!, reason: c.reason === "fraud" ? "FRAUD" : c.reason === "out_of_stock" ? "INVENTORY" : c.reason === "customer_cancelled" ? "CUSTOMER" : "OTHER", note: `Mizan: cancelled (${c.reason})` }), clock));
      } else {
        count(await engineQueue({ woocommerce: storeId }).enqueue(MizanEngine.wooCancelJob({ orderId: c.external_id!, note: `Mizan: cancelled (${c.reason})` }), clock));
      }
    }

    await engineQueue({}).put<GuardRound>("guardian", "round", { at: new Date(now).toISOString() }, clock);
    // Copies Mizan has no baseline for: read now (the read takes the copy as it is; webhooks may never come).
    if (provider === "shopify") {
      const unread = await trx.selectFrom("orders").select("store_copy_id").where("store_copy_connection_id", "=", storeId).where("store_copy_id", "is not", null)
        .where(sql<boolean>`(store_copy_snapshot ->> 'v') is distinct from ${String(COPY_SNAPSHOT_VERSION)}`).limit(50).execute();
      for (const u of unread) {
        count(await engineQueue({ shopify: storeId }).enqueue({ kind: "shopify.ingestOrder", connection: "shopify", payload: { orderId: u.store_copy_id! }, idempotencyKey: `shopify:order:${u.store_copy_id}:baseline:v${COPY_SNAPSHOT_VERSION}` }, clock));
      }
      // U26: copies made before customers and governorate codes were sent are put right once each
      // (a cursor walks them, a few per round; the job's key makes a repeat a no-op).
      // The walk ends once it reaches the last copy (new copies are made right); its jobs are no recovery count.
      const queue = engineQueue({ shopify: storeId });
      const cursor = await queue.get<{ after?: string; done?: boolean }>("guardian", `copy-repair:${COPY_REPAIR}`);
      if (!cursor?.done) {
        const old = await trx.selectFrom("orders").select("id").where("store_copy_connection_id", "=", storeId).where("store_copy_id", "is not", null)
          .where("status", "!=", "cancelled").where("pii_redacted_at", "is", null)
          .$if(Boolean(cursor?.after), (q) => q.where("id", ">", cursor!.after!)).orderBy("id").limit(25).execute();
        for (const o of old) await queue.enqueue(MizanEngine.shopifyRepairCopyJob(o.id, COPY_REPAIR), clock);
        await queue.put("guardian", `copy-repair:${COPY_REPAIR}`, old.length ? { after: old.at(-1)!.id } : { ...cursor, done: true }, clock);
      }
    }

    // Orders made in Mizan with no copy in the store yet (the job lost, or made before the switch): queued (a no-op when queued).
    if (provider === "shopify") {
      const first = await trx.selectFrom("connections").select("id").where("kind", "=", "store").where("provider", "=", "shopify").where("status", "=", "active").orderBy("created_at").executeTakeFirst();
      const missing = await trx.selectFrom("orders").select("id").where("connection_id", "is", null).where("status", "!=", "cancelled").where("created_at", ">", since)
        .where((w) => w.or([w("store_copy_status", "=", "pending").and("store_copy_connection_id", "=", storeId), first?.id === storeId ? w("store_copy_status", "is", null) : w.val(false)]))
        .limit(200).execute();
      for (const m of missing) if (await this.storeOrders?.queue(trx, tenantId, m.id)) reasserted++;
    }

    if (rebooked || reasserted) {
      await this.events.emit(trx, { type: "sync.recovered", tenantId, entity: { type: "connection", id: storeId }, actor: { type: "system" }, data: { rebooked, reasserted } });
    }
    return { rebooked, reasserted };
  }
}

import { createHash } from "node:crypto";
import { cashToCollect, deliveryCompletesPayment, ShipBlockedError, type ShipBlockReason } from "../core/payments.js";
import { IntegrationError } from "../core/errors.js";
import type { CanonicalOrder, CanonicalProduct, CanonicalShipment, ProductPatch, ShipmentStatus } from "@mizan/shared";
import { TERMINAL_STATUSES } from "@mizan/shared";
import type { Runtime } from "../core/runtime.js";
import { DriftMonitor } from "../adapt/drift.js";
import { ShapeWatch } from "../adapt/shape.js";
import { shouldApplyStatus } from "../adapt/status.js";
import { BostaConnector, type BostaConfig, type BostaLearned } from "../connectors/bosta/connector.js";
import { ShopifyConnector, type ShopifyLearned } from "../connectors/shopify/connector.js";
import type { ShopifyCredentials } from "../connectors/shopify/client.js";
import { gidFromWebhook } from "../connectors/shopify/mapper.js";
import { readShopifyHeaders, verifyShopifyHmac } from "../connectors/shopify/webhooks.js";
import type { NewJob, OutboxJob, Store } from "../sync/store.js";
import { DEFAULT_WORKER, OutboxWorker, type JobOutcome, type WorkerOptions } from "../sync/worker.js";

export type Owner = "mizan" | "shopify";

export interface EngineOptions {
  shopify: ShopifyCredentials;
  bosta: BostaConfig;
  /** Shopify location Mizan manages stock for. */
  locationId?: string;
  /** Which system wins when a field differs. Mizan-owned fields edited in Shopify are restored; Shopify-owned ones are accepted. */
  ownership?: { price: Owner; compareAtPrice: Owner; inventory: Owner };
  /** Ship automatically when an order carries this tag (set by Mizan's confirmation module). */
  autoShipTag?: string | null;
  markCodPaidOnDelivery?: boolean;
  tagOnReturn?: string;
  trackingCompany?: string;
  /** Overlap when polling, to cover clock skew and late writes. */
  pollOverlapMs?: number;
  /** Writes younger than this are "in flight"; differing reads in this window are not treated as conflicts. */
  echoWindowMs?: number;
  worker?: Partial<WorkerOptions>;
  /** What the connectors learned before (the platform keeps it in connections.learned). Wins over the store copy. */
  learned?: { shopify?: Partial<ShopifyLearned>; bosta?: Partial<BostaLearned> };
  /**
   * Awaited inside the job, so a failing hook fails (and retries) the job:
   * nothing is acknowledged before the platform has stored it.
   */
  hooks?: {
    /** A fresh canonical order (fat fetch) and the engine's previous copy. Must be idempotent. */
    onOrder?: (order: CanonicalOrder, previous: CanonicalOrder | undefined) => Promise<void>;
    /** A confirmed order cannot ship yet because of its payment (unpaid transfer, failed or unknown method). */
    onAwaitingPayment?: (order: CanonicalOrder, reason: ShipBlockReason) => Promise<void>;
    /** A connector learned something new (status code, city alias, query variant). Called only on change. */
    onLearned?: (provider: "shopify" | "bosta", state: ShopifyLearned | BostaLearned) => Promise<void>;
    /** A product read from the store (webhook, refetch or backfill page), without `raw`. Must be idempotent. */
    onProduct?: (product: CanonicalProduct) => Promise<void>;
    /** The courier credentials were checked (bosta.checkAccess): accepted, or refused and why. */
    onAccessChecked?: (provider: "bosta", result: AccessCheck) => Promise<void>;
    /** An accepted offer was added to the store's order (E6-13), or could not be. Must be idempotent. */
    onOfferResult?: (offerId: string, result: OfferOutcome) => Promise<void>;
  };
}

/** Adding an offer to the store's order: done (now or before), or why not (final; the team adds it by hand). */
export type OfferOutcome = { ok: true; outcome: "added" | "already_added" } | { ok: false; reason: "validation" | "not_found" | "permission" | "failed"; message: string };

export interface OfferJob { offerId: string; orderId: string; variantId: string; qty: number; discountPct: string; note: string }

/** The outcome of checking a courier key: a refusal is final (the merchant must fix the key), not retried. */
export type AccessCheck = { ok: true } | { ok: false; reason: "auth" | "permission"; message: string };

export interface WebhookResult {
  status: number;
  body: Record<string, unknown>;
}

interface OrderRecord {
  /** Without personal data (`withoutPersonalData`): the engine keeps ids, money, statuses and the area only. */
  order: CanonicalOrder;
  trackingNumber?: string;
  fulfilled?: boolean;
  paidMarked?: boolean;
}

interface BackfillPage {
  runKey: string;
  since: string;
  /** When the run was queued: a run started after this supersedes it. */
  queuedAt: number;
  phase: "orders" | "products";
  after: string | null;
}

export interface BackfillProgress {
  runKey: string;
  since: string;
  queuedAt: number;
  status: "running" | "done";
  phase: "orders" | "products" | "done";
  orders: number;
  products: number;
  pages: number;
  startedAt: string;
  finishedAt?: string;
}

interface ShipmentRecord {
  shipment: CanonicalShipment;
  orderId: string;
  statusAt: number;
}

interface ProductState {
  productId: string;
  desired: {
    variants: Record<string, { price?: string; compareAtPrice?: string | null }>;
    inventory: Record<string, number>; // `${inventoryItemId}|${locationId}` → available
  };
  lastWriteAt?: number;
  snapshot?: CanonicalProduct;
}

type Listener = (event: string, data: Record<string, unknown>) => void;

/** Webhooks the engine handles (handleShopifyWebhook), as GraphQL WebhookSubscriptionTopic values. */
export const SHOPIFY_WEBHOOK_TOPICS = ["ORDERS_CREATE", "ORDERS_UPDATED", "ORDERS_CANCELLED", "PRODUCTS_UPDATE", "APP_UNINSTALLED"] as const;

const iso = (v: string | number | undefined) => (v === undefined ? undefined : new Date(v).toISOString());
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);

/**
 * The Mizan integration engine.
 *
 *   webhooks ─▶ verify ─▶ dedupe ─▶ outbox job ─▶ worker ─▶ connector ─▶ provider
 *   polling  ─▶ reconcile ─────────▶ outbox job ┘
 *
 * Webhooks are acknowledged in milliseconds; all real work runs as outbox
 * jobs with retries, backoff, idempotency keys and a dead-letter queue.
 * Polling re-reads recent changes on a schedule, so a missed webhook delays
 * an update by one poll interval instead of losing it.
 */
export class MizanEngine {
  readonly drift = new DriftMonitor();
  readonly shapes = new ShapeWatch();
  readonly shopify: ShopifyConnector;
  readonly bosta: BostaConnector;
  readonly worker: OutboxWorker;
  private readonly listeners: Listener[] = [];
  private readonly opts: Required<Omit<EngineOptions, "shopify" | "bosta" | "worker" | "locationId" | "hooks" | "learned">> & Pick<EngineOptions, "locationId" | "hooks" | "learned">;
  /** Last learned state persisted per provider (JSON), to persist only changes. */
  private readonly learnedSaved: Record<"shopify" | "bosta", string> = { shopify: "", bosta: "" };

  constructor(private readonly store: Store, private readonly rt: Runtime, options: EngineOptions) {
    this.opts = {
      ownership: { price: "mizan", compareAtPrice: "mizan", inventory: "mizan" },
      autoShipTag: "mizan-confirmed",
      markCodPaidOnDelivery: true,
      tagOnReturn: "mizan-returned",
      trackingCompany: "Bosta",
      pollOverlapMs: 10 * 60_000,
      echoWindowMs: 2 * 60_000,
      ...options,
    };
    this.shopify = new ShopifyConnector(options.shopify, rt, this.drift, this.shapes);
    this.bosta = new BostaConnector(options.bosta, rt, this.drift, this.shapes);
    this.worker = new OutboxWorker(store, rt, this.handlers(), { ...DEFAULT_WORKER, ...options.worker });
    this.worker.onOutcome((o) => this.onOutcome(o));
    this.drift.onNew((e) => this.emit("drift", { ...e }));
  }

  on(listener: Listener) {
    this.listeners.push(listener);
  }

  private emit(event: string, data: Record<string, unknown>) {
    this.rt.logger.log(event === "job.dead" || event === "drift" ? "warn" : "info", event, data);
    for (const l of this.listeners) l(event, data);
  }

  private now() {
    return this.rt.clock.now();
  }

  async init() {
    const bosta = this.opts.learned?.bosta ?? (await this.store.get<BostaLearned>("learned", "bosta"));
    const shopify = this.opts.learned?.shopify ?? (await this.store.get<ShopifyLearned>("learned", "shopify"));
    if (bosta) this.bosta.loadLearned(bosta);
    if (shopify) this.shopify.loadLearned(shopify);
    this.learnedSaved.bosta = JSON.stringify(this.bosta.exportLearned());
    this.learnedSaved.shopify = JSON.stringify(this.shopify.exportLearned());
  }

  /** Persist learned state that changed: in the engine store, and through hooks.onLearned. */
  private async saveLearned() {
    for (const provider of ["bosta", "shopify"] as const) {
      const state = provider === "bosta" ? this.bosta.exportLearned() : this.shopify.exportLearned();
      const json = JSON.stringify(state);
      if (json === this.learnedSaved[provider]) continue;
      await this.store.put("learned", provider, state, this.now());
      await this.runHook(() => this.opts.hooks?.onLearned?.(provider, state));
      this.learnedSaved[provider] = json;
    }
  }

  private enqueue(kind: string, payload: unknown, idempotencyKey: string, runAt?: number) {
    return this.store.enqueue({ kind, connection: kind.split(".")[0], payload, idempotencyKey, runAt }, this.now());
  }

  // ═════════════ inbound: webhooks ═════════════

  async handleShopifyWebhook(headers: Record<string, string | undefined>, rawBody: string): Promise<WebhookResult> {
    const hmac = headers["X-Shopify-Hmac-SHA256"] ?? headers["x-shopify-hmac-sha256"];
    if (!verifyShopifyHmac(rawBody, hmac, this.opts_shopifySecret())) return { status: 401, body: { error: "invalid signature" } };
    const meta = readShopifyHeaders(headers);
    const dedupeKey = `shopify:${meta.eventId ?? meta.webhookId ?? hash(rawBody)}`;
    if (!(await this.store.markInbound(dedupeKey, this.now()))) return { status: 200, body: { duplicate: true } };

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return { status: 200, body: { ignored: "unparseable body" } }; // never make Shopify retry a body we can't read
    }
    const version = iso((payload.updated_at as string) ?? undefined) ?? meta.eventId ?? hash(rawBody);
    if (meta.topic.startsWith("orders/")) {
      const id = gidFromWebhook("Order", payload);
      // Keyed by Shopify's event id, not updated_at: updated_at has 1-second precision, so an order created
      // and paid within the same second would otherwise lose its payment update. Duplicate deliveries of one
      // event are already dropped above; re-ingesting is safe (fat fetch, idempotent writes).
      if (id) await this.enqueue("shopify.ingestOrder", { orderId: id }, `shopify:order:${id}:${meta.eventId ?? version}`);
    } else if (meta.topic.startsWith("products/") && meta.topic !== "products/delete") {
      const id = gidFromWebhook("Product", payload);
      if (id) await this.enqueue("shopify.ingestProduct", { productId: id }, `shopify:product:${id}:${version}`);
    } else if (meta.topic === "app/uninstalled") {
      this.emit("connection.uninstalled", { shop: meta.shop });
    }
    return { status: 200, body: { accepted: true } };
  }

  private opts_shopifySecret() {
    return this.shopify.creds.clientSecret;
  }

  async handleBostaWebhook(query: Record<string, string | undefined>, headers: Record<string, string | undefined>, rawBody: string): Promise<WebhookResult> {
    const token = query.token ?? headers["x-mizan-token"] ?? headers["authorization"];
    if (!this.bosta.verifyWebhook(token)) return { status: 401, body: { error: "invalid token" } };
    let hint: ReturnType<BostaConnector["parseWebhook"]>;
    try {
      hint = this.bosta.parseWebhook(JSON.parse(rawBody));
    } catch {
      return { status: 200, body: { ignored: "unrecognised payload; recorded as drift" } };
    }
    const key = `bosta:${hint.trackingNumber}:${hint.code ?? hint.label ?? ""}:${hint.at ?? hash(rawBody)}`;
    if (!(await this.store.markInbound(key, this.now()))) return { status: 200, body: { duplicate: true } };
    await this.enqueue("bosta.ingestStatus", { trackingNumber: hint.trackingNumber, hint }, key);
    return { status: 200, body: { accepted: true } };
  }

  // ═════════════ commands ═════════════

  /** Ship an order with Bosta (normally called by the confirmation module). */
  async shipOrder(orderId: string) {
    return this.enqueue("bosta.createShipment", { orderId }, `ship:${orderId}`);
  }

  /**
   * Change product data from Mizan (price, compare-at price, stock).
   * The new values become Mizan's desired state and are pushed to Shopify.
   * Identical desired states collapse into one job.
   */
  async updateProduct(patch: ProductPatch) {
    const state = (await this.store.get<ProductState>("product-state", patch.productExternalId)) ?? { productId: patch.productExternalId, desired: { variants: {}, inventory: {} } };
    for (const v of patch.variants ?? []) {
      const cur = state.desired.variants[v.externalId] ?? {};
      if (v.price) cur.price = v.price.amount;
      if (v.compareAtPrice !== undefined) cur.compareAtPrice = v.compareAtPrice ? v.compareAtPrice.amount : null;
      state.desired.variants[v.externalId] = cur;
    }
    for (const inv of patch.inventory ?? []) state.desired.inventory[`${inv.inventoryItemId}|${inv.locationId}`] = inv.available;
    await this.store.put("product-state", patch.productExternalId, state, this.now());
    return this.enqueue("shopify.pushProduct", { patch }, `push:${patch.productExternalId}:${hash({ patch, desired: state.desired })}`);
  }

  /**
   * Subscribe the store to the webhooks the engine handles (on connect and reconnect).
   * `runKey` makes each connect its own job: an uninstall drops Shopify's subscriptions,
   * so a reinstall must register again even if an earlier job already ran.
   */
  async registerShopifyWebhooks(runKey: string) {
    const j = MizanEngine.shopifyWebhooksJob(runKey);
    return this.enqueue(j.kind, j.payload, j.idempotencyKey);
  }

  /** The job registerShopifyWebhooks queues, for callers that enqueue inside their own transaction. */
  /**
   * Check a newly saved courier key with a harmless authenticated read (a delivery search for a
   * reference that never exists). Runs as a job, never in a request: network trouble retries,
   * a refused key ends the job and reports through hooks.onAccessChecked.
   */
  static bostaAccessCheckJob(runKey: string): NewJob<Record<string, never>> {
    return { kind: "bosta.checkAccess", connection: "bosta", payload: {}, idempotencyKey: `bosta:access:${runKey}` };
  }

  /** Add an accepted offer to the store's order (E6-13): one job per offer, whatever happens. */
  static shopifyOfferJob(p: OfferJob): NewJob<OfferJob> {
    return { kind: "shopify.addOffer", connection: "shopify", payload: p, idempotencyKey: `shopify:offer:${p.offerId}` };
  }

  /** Tag a store order (Mizan's decisions the merchant should see in Shopify, e.g. mizan-duplicate); tags are idempotent. */
  static shopifyTagJob(orderId: string, tags: string[], key: string): NewJob<{ id: string; tags: string[] }> {
    return { kind: "shopify.addTags", connection: "shopify", payload: { id: orderId, tags }, idempotencyKey: `tag:${orderId}:${tags.join(",")}:${key}` };
  }

  static shopifyWebhooksJob(runKey: string): NewJob<Record<string, never>> {
    return { kind: "shopify.syncWebhooks", connection: "shopify", payload: {}, idempotencyKey: `shopify:webhooks:${runKey}` };
  }

  /**
   * Import the store's history on connect: orders created since `sinceMs` (Shopify serves 60 days
   * without read_all_orders), then every product. One page per job, the cursor in the next job:
   * resumable after a restart, paced by the cost limiter, interleaved with live webhooks.
   */
  static shopifyBackfillJob(runKey: string, sinceMs: number, queuedAt: number): NewJob<BackfillPage> {
    return {
      kind: "shopify.backfill", connection: "shopify", idempotencyKey: `shopify:backfill:${runKey}:orders:start`,
      payload: { runKey, since: new Date(sinceMs).toISOString(), queuedAt, phase: "orders", after: null },
    };
  }

  /** Progress of the latest backfill, or null before the first connect. */
  async backfillStatus(): Promise<BackfillProgress | null> {
    return (await this.store.get<BackfillProgress>("backfill", "shopify")) ?? null;
  }

  private async backfillPage(p: BackfillPage) {
    const progress = await this.backfillStatus();
    // Runs are ordered by (queuedAt, runKey). A newer run has started: this older chain stops here.
    if (progress && progress.runKey !== p.runKey && (progress.queuedAt > p.queuedAt || (progress.queuedAt === p.queuedAt && progress.runKey > p.runKey))) return;
    const state: BackfillProgress = progress?.runKey === p.runKey ? progress
      : { runKey: p.runKey, since: p.since, queuedAt: p.queuedAt, status: "running", phase: "orders", orders: 0, products: 0, pages: 0, startedAt: new Date(this.now()).toISOString() };
    let next: BackfillPage | null;
    if (p.phase === "orders") {
      const page = await this.shopify.ordersPage(`created_at:>='${p.since}'`, p.after);
      for (const o of page.nodes) await this.ingestOrderData(o);
      state.orders += page.nodes.length;
      next = page.next ? { ...p, after: page.next } : { ...p, phase: "products", after: null };
    } else {
      const page = await this.shopify.productsPage(null, p.after);
      for (const product of page.nodes) await this.ingestProductData(product);
      state.products += page.nodes.length;
      next = page.next ? { ...p, after: page.next } : null;
    }
    state.pages++;
    state.phase = next?.phase ?? "done";
    if (!next) {
      state.status = "done";
      state.finishedAt = new Date(this.now()).toISOString();
    }
    await this.store.put("backfill", "shopify", state, this.now());
    this.emit(next ? "backfill.progress" : "backfill.completed", { runKey: p.runKey, phase: state.phase, orders: state.orders, products: state.products, pages: state.pages });
    if (next) await this.enqueue("shopify.backfill", next, `shopify:backfill:${p.runKey}:${next.phase}:${next.after ?? "start"}`);
  }

  /** Schedule reconciliation polls. Call every few minutes from a timer or cron. */
  async scheduleReconcile(intervalMs = 5 * 60_000) {
    const slot = Math.floor(this.now() / intervalMs);
    await this.enqueue("shopify.pollOrders", {}, `poll:orders:${slot}`);
    await this.enqueue("bosta.pollActive", {}, `poll:bosta:${slot}`);
  }

  /** Ops fixed an address the engine could not match: remember it and retry the stuck job. */
  async resolveCity(addressText: string, bostaCityId: string, jobId?: string) {
    this.bosta.learnCityAlias(addressText, bostaCityId);
    await this.saveLearned();
    if (jobId) return this.store.replay(jobId, this.now());
    return true;
  }

  replay(jobId: string) {
    return this.store.replay(jobId, this.now());
  }

  /** Run due jobs until none are left (tests, CLI). Production calls `worker.tick()` on an interval. */
  async drain(maxTicks = 500) {
    let total = 0;
    for (let i = 0; i < maxTicks; i++) {
      const n = await this.worker.tick();
      total += n;
      if (n === 0) break;
    }
    return total;
  }

  async health() {
    const [pending, dead] = await Promise.all([this.store.jobs({ status: "pending" }), this.store.jobs({ status: "dead" })]);
    return {
      shopify: this.shopify.health(),
      bosta: this.bosta.health(),
      outbox: { pending: pending.length, dead: dead.length },
      deadLetters: dead.slice(-20).map((j) => ({ id: j.id, kind: j.kind, attempts: j.attempts, error: j.lastError })),
      drift: this.drift.report().slice(0, 20),
    };
  }

  /** Platform-side failures (database, network) are retried with backoff, not dead-lettered at once. */
  private async runHook(fn: () => Promise<void> | undefined) {
    try {
      await fn();
    } catch (e) {
      if (e instanceof IntegrationError) throw e;
      throw new IntegrationError({ kind: "transient", connector: "platform", message: e instanceof Error ? e.message : String(e), cause: e });
    }
  }

  // ═════════════ job handlers ═════════════

  private handlers(): Record<string, (job: OutboxJob<any>) => Promise<void>> {
    const handlers = this.jobHandlers();
    return Object.fromEntries(Object.entries(handlers).map(([kind, run]) => [kind, async (job: OutboxJob<any>) => {
      try {
        await run(job);
      } finally {
        await this.saveLearned().catch((e) => this.rt.logger.log("warn", "could not persist learned state", { error: e instanceof Error ? e.message : String(e) }));
      }
    }]));
  }

  private jobHandlers(): Record<string, (job: OutboxJob<any>) => Promise<void>> {
    return {
      "shopify.ingestOrder": (j) => this.ingestOrder(j.payload.orderId),
      "shopify.ingestProduct": (j) => this.ingestProduct(j.payload.productId),
      "shopify.pollOrders": () => this.pollOrders(),
      "bosta.pollActive": () => this.pollActiveShipments(),
      "bosta.createShipment": (j) => this.createShipment(j.payload.orderId, j.attempts),
      "shopify.fulfill": (j) => this.fulfill(j.payload.orderId, j.payload.trackingNumber),
      "bosta.ingestStatus": (j) => this.ingestShipmentStatus(j.payload.trackingNumber),
      "shopify.markPaid": (j) => this.markPaid(j.payload.orderId),
      "shopify.addTags": (j) => this.shopify.addTags(j.payload.id, j.payload.tags),
      "shopify.pushProduct": (j) => this.pushProduct(j.payload.patch, j.idempotencyKey),
      "shopify.syncWebhooks": () => this.syncShopifyWebhooks(),
      "shopify.backfill": (j) => this.backfillPage(j.payload),
      "bosta.checkAccess": () => this.checkBostaAccess(),
      "shopify.addOffer": (j) => this.addOffer(j.payload),
    };
  }

  private async addOffer(p: OfferJob) {
    let outcome: OfferOutcome;
    try {
      const r = await this.shopify.addOfferToOrder({ orderId: p.orderId, variantId: p.variantId, qty: p.qty, discountPct: p.discountPct, marker: p.offerId, note: p.note });
      outcome = { ok: true, outcome: r };
    } catch (e) {
      // Retryable trouble is retried by the worker (and reported if it never succeeds); the rest is final.
      if (!(e instanceof IntegrationError) || e.retryable) throw e;
      const reason = e.kind === "validation" || e.kind === "not_found" ? e.kind : e.kind === "auth" || e.kind === "permission" ? "permission" : "failed";
      await this.runHook(() => this.opts.hooks?.onOfferResult?.(p.offerId, { ok: false, reason, message: e.message }));
      this.emit("offer.failed", { offerId: p.offerId, orderId: p.orderId, reason });
      if (reason === "permission") throw e; // the store must approve order edits again: surfaces as needs attention
      return;
    }
    // Fat fetch: the order's new total and line come back like any other order change.
    await this.ingestOrder(p.orderId);
    await this.runHook(() => this.opts.hooks?.onOfferResult?.(p.offerId, outcome));
    this.emit("offer.applied", { offerId: p.offerId, orderId: p.orderId, outcome: outcome.ok ? outcome.outcome : "failed" });
  }

  private async checkBostaAccess() {
    let result: AccessCheck;
    try {
      await this.bosta.findByReference(`mizan-access-check-${this.now()}`);
      result = { ok: true };
    } catch (e) {
      if (!(e instanceof IntegrationError) || (e.kind !== "auth" && e.kind !== "permission")) throw e; // retry the rest
      result = { ok: false, reason: e.kind, message: e.message };
    }
    await this.runHook(() => this.opts.hooks?.onAccessChecked?.("bosta", result));
    this.emit("bosta.access_checked", { ok: result.ok, ...(result.ok ? {} : { reason: result.reason }) });
  }

  private async syncShopifyWebhooks() {
    const uri = this.shopify.creds.webhookUrl;
    if (!uri) throw new IntegrationError({ kind: "validation", connector: "shopify", message: "no webhook URL configured for this store" });
    const r = await this.shopify.syncWebhooks(uri, SHOPIFY_WEBHOOK_TOPICS);
    this.emit("shopify.webhooks_synced", { topics: [...SHOPIFY_WEBHOOK_TOPICS], created: r.created, deleted: r.deleted });
  }

  private async ingestOrder(orderId: string) {
    await this.ingestOrderData(await this.shopify.getOrder(orderId));
  }

  /** Record an order read from Shopify (single read or a page) and react to what changed. */
  private async ingestOrderData(order: CanonicalOrder) {
    const orderId = order.externalId;
    const prev = await this.store.get<OrderRecord>("order", orderId);
    const full: CanonicalOrder = { ...order, raw: undefined };
    const rec: OrderRecord = { ...prev, order: withoutPersonalData(full) };
    // Mizan's projector gets the whole order (it encrypts personal data); the engine's record does not keep it.
    await this.runHook(() => this.opts.hooks?.onOrder?.(full, prev?.order));
    await this.store.put("order", orderId, rec, this.now());
    this.emit("order.ingested", { orderId, number: order.number, paymentMode: order.paymentMode, paymentStatus: order.paymentStatus, updatedAt: order.updatedAt });
    const before = prev?.order;
    if (before && (before.paymentStatus !== order.paymentStatus || before.refunded?.amount !== order.refunded?.amount)) {
      this.emit("order.payment_changed", {
        orderId, mode: order.paymentMode, from: before.paymentStatus, to: order.paymentStatus,
        received: order.received?.amount, outstanding: order.outstanding?.amount, refunded: order.refunded?.amount,
      });
    }

    if (order.cancelled && rec.trackingNumber) {
      this.emit("order.cancelled_after_shipping", { orderId, trackingNumber: rec.trackingNumber }); // ops decides whether to terminate the delivery
      return;
    }
    if (this.opts.autoShipTag && order.tags.includes(this.opts.autoShipTag) && !order.cancelled && !rec.trackingNumber) {
      // Confirmed orders ship automatically only once payment allows it. An unpaid bank transfer
      // waits; the next orders/updated webhook (or poll) after payment ships it.
      try {
        cashToCollect(order);
      } catch (e) {
        if (e instanceof ShipBlockedError) {
          await this.runHook(() => this.opts.hooks?.onAwaitingPayment?.(full, e.reason));
          this.emit("order.awaiting_payment", { orderId, number: order.number, reason: e.reason, mode: order.paymentMode, status: order.paymentStatus });
          return;
        }
        throw e;
      }
      await this.shipOrder(orderId);
    }
  }

  private async createShipment(orderId: string, attempt: number) {
    const rec = await this.store.get<OrderRecord>("order", orderId);
    if (rec?.trackingNumber) return; // already shipped
    // Fat fetch: the courier needs the address and phone, which the engine does not keep; and the
    // order may have changed (address edited, cancelled) since it was recorded.
    const order = await this.shopify.getOrder(orderId);
    if (order.cancelled) throw new IntegrationError({ kind: "validation", connector: "engine", message: `order ${order.number} is cancelled` });
    cashToCollect(order); // fail fast with a clear reason (awaiting_payment, payment_mode_unknown …) before calling the courier

    const { shipment, adopted } = await this.bosta.createShipmentOnce(order, orderId, attempt > 1);
    await this.saveLearned();
    await this.store.put<OrderRecord>("order", orderId, { ...(rec ?? {}), order: withoutPersonalData({ ...order, raw: undefined }), trackingNumber: shipment.trackingNumber }, this.now());
    await this.store.put<ShipmentRecord>("shipment", shipment.trackingNumber, { shipment: { ...shipment, raw: undefined }, orderId, statusAt: Date.parse(shipment.updatedAt) || this.now() }, this.now());
    this.emit("shipment.created", { orderId, trackingNumber: shipment.trackingNumber, adopted, cod: shipment.cod.amount });
    await this.enqueue("shopify.fulfill", { orderId, trackingNumber: shipment.trackingNumber }, `fulfill:${orderId}:${shipment.trackingNumber}`);
  }

  private async fulfill(orderId: string, trackingNumber: string) {
    const result = await this.shopify.fulfillWithTracking(orderId, {
      company: this.opts.trackingCompany, number: trackingNumber, url: this.bosta.trackingUrl(trackingNumber),
    });
    const rec = await this.store.get<OrderRecord>("order", orderId);
    if (rec) await this.store.put<OrderRecord>("order", orderId, { ...rec, fulfilled: true }, this.now());
    this.emit("order.fulfilled", { orderId, trackingNumber, result });
  }

  private async ingestShipmentStatus(trackingNumber: string) {
    const rec = await this.store.get<ShipmentRecord>("shipment", trackingNumber);
    const fresh = await this.bosta.getShipment(trackingNumber); // fat fetch: never trust the webhook body alone
    await this.saveLearned();
    const freshAt = Date.parse(fresh.updatedAt) || this.now();
    const orderId = rec?.orderId ?? fresh.orderRef;
    if (!orderId) {
      this.emit("shipment.orphan", { trackingNumber }); // created outside Mizan
      return;
    }
    const current = rec?.shipment.status;
    if (fresh.status === "unknown") {
      this.emit("shipment.needs_review", { trackingNumber, orderId, rawStatus: fresh.rawStatus });
    }
    if (!shouldApplyStatus(current, fresh.status, rec?.statusAt, freshAt)) {
      if (current !== fresh.status) this.emit("shipment.status_ignored", { trackingNumber, current, received: fresh.status });
      return;
    }
    await this.store.put<ShipmentRecord>("shipment", trackingNumber, { shipment: { ...fresh, raw: undefined }, orderId, statusAt: freshAt }, this.now());
    this.emit("shipment.status", { trackingNumber, orderId, from: current, to: fresh.status, raw: fresh.rawStatus });
    await this.afterStatusChange(orderId, fresh.status, trackingNumber);
  }

  private async afterStatusChange(orderId: string, status: ShipmentStatus, trackingNumber: string) {
    const rec = await this.store.get<OrderRecord>("order", orderId);
    if (status === "delivered" && this.opts.markCodPaidOnDelivery && rec && deliveryCompletesPayment(rec.order)) {
      await this.enqueue("shopify.markPaid", { orderId }, `paid:${orderId}`);
    }
    if (status === "returned" && this.opts.tagOnReturn) {
      await this.enqueue("shopify.addTags", { id: orderId, tags: [this.opts.tagOnReturn] }, `tag:${orderId}:${this.opts.tagOnReturn}:${trackingNumber}`);
    }
  }

  private async markPaid(orderId: string) {
    const result = await this.shopify.markPaid(orderId);
    const rec = await this.store.get<OrderRecord>("order", orderId);
    if (rec) await this.store.put<OrderRecord>("order", orderId, { ...rec, paidMarked: true }, this.now());
    this.emit("order.paid", { orderId, result });
  }

  private async pushProduct(patch: ProductPatch, opKey: string) {
    const state = await this.store.get<ProductState>("product-state", patch.productExternalId);
    // Always push the latest desired values, not the (possibly stale) patch that queued this job.
    const latest: ProductPatch = { ...patch };
    if (state) {
      latest.variants = patch.variants?.map((v) => {
        const d = state.desired.variants[v.externalId];
        return d ? { externalId: v.externalId, ...(d.price !== undefined ? { price: { amount: d.price, currency: "" } } : {}), ...(d.compareAtPrice !== undefined ? { compareAtPrice: d.compareAtPrice === null ? null : { amount: d.compareAtPrice, currency: "" } } : {}) } : v;
      });
      latest.inventory = patch.inventory?.map((i) => ({ ...i, available: state.desired.inventory[`${i.inventoryItemId}|${i.locationId}`] ?? i.available }));
    }
    await this.shopify.applyProductPatch(latest, hash(opKey));
    if (state) await this.store.put<ProductState>("product-state", patch.productExternalId, { ...state, lastWriteAt: this.now() }, this.now());
    this.emit("product.pushed", { productId: patch.productExternalId, variants: latest.variants?.length ?? 0, inventory: latest.inventory?.length ?? 0 });
  }

  /**
   * A product changed in Shopify (webhook or poll). Shopify-owned fields
   * (title, description, tags, status) are taken as-is. Mizan-owned fields
   * (price, compare-at price) are compared with Mizan's desired values:
   *   equal              → in sync (this is also how our own echo is ignored)
   *   differ, write just made → our write is still propagating: ignore
   *   differ, owner Mizan    → someone edited it in Shopify admin: restore
   *   differ, owner Shopify  → accept Shopify's value into Mizan
   */
  private async ingestProduct(productId: string) {
    await this.ingestProductData(await this.shopify.getProduct(productId));
  }

  private async ingestProductData(product: CanonicalProduct) {
    const productId = product.externalId;
    const state = (await this.store.get<ProductState>("product-state", productId)) ?? { productId, desired: { variants: {}, inventory: {} } };
    const inFlight = state.lastWriteAt !== undefined && this.now() - state.lastWriteAt < this.opts.echoWindowMs;
    const restore: NonNullable<ProductPatch["variants"]> = [];

    for (const v of product.variants) {
      const want = state.desired.variants[v.externalId];
      if (!want) continue;
      const priceDiff = want.price !== undefined && Number(want.price) !== Number(v.price.amount);
      const capHave = v.compareAtPrice ? v.compareAtPrice.amount : null;
      const capDiff = want.compareAtPrice !== undefined && (want.compareAtPrice === null ? capHave !== null : Number(want.compareAtPrice) !== Number(capHave));
      if (!priceDiff && !capDiff) continue;
      if (inFlight) continue;
      const fix: { externalId: string; price?: { amount: string; currency: string }; compareAtPrice?: { amount: string; currency: string } | null } = { externalId: v.externalId };
      if (priceDiff) {
        if (this.opts.ownership.price === "mizan") fix.price = { amount: want.price!, currency: "" };
        else want.price = v.price.amount;
      }
      if (capDiff) {
        if (this.opts.ownership.compareAtPrice === "mizan") fix.compareAtPrice = want.compareAtPrice ? { amount: want.compareAtPrice, currency: "" } : null;
        else want.compareAtPrice = capHave;
      }
      if (fix.price || fix.compareAtPrice !== undefined) restore.push(fix);
      this.emit("product.conflict", { productId, variantId: v.externalId, shopifyPrice: v.price.amount, mizanPrice: want.price, action: fix.price || fix.compareAtPrice !== undefined ? "restore_mizan_value" : "accepted_shopify_value" });
    }

    await this.store.put<ProductState>("product-state", productId, { ...state, snapshot: { ...product, raw: undefined } }, this.now());
    await this.runHook(() => this.opts.hooks?.onProduct?.({ ...product, raw: undefined }));
    this.emit("product.ingested", { productId, title: product.title, status: product.status });
    if (restore.length) {
      await this.enqueue("shopify.pushProduct", { patch: { productExternalId: productId, variants: restore } }, `restore:${productId}:${hash(restore)}:${product.updatedAt}`);
    }
  }

  private async pollOrders() {
    const cursor = (await this.store.get<{ since: string }>("cursor", "shopify.orders"))?.since ?? new Date(this.now() - 24 * 3600_000).toISOString();
    const since = new Date(Date.parse(cursor) - this.opts.pollOverlapMs).toISOString();
    let maxSeen = cursor;
    for await (const page of this.shopify.ordersUpdatedSince(since)) {
      for (const o of page) {
        const known = await this.store.get<OrderRecord>("order", o.externalId);
        // Compare what Mizan acts on, not only updated_at (1-second precision): a payment or tag change in the
        // same second as the previous version must still be picked up.
        const fp = orderFingerprint(o);
        if (!known || orderFingerprint(known.order) !== fp) {
          await this.enqueue("shopify.ingestOrder", { orderId: o.externalId }, `shopify:order:${o.externalId}:poll:${hash(fp)}`);
        }
        if (Date.parse(o.updatedAt) > Date.parse(maxSeen)) maxSeen = o.updatedAt;
      }
    }
    await this.store.put("cursor", "shopify.orders", { since: maxSeen }, this.now());
  }

  private async pollActiveShipments() {
    const slot = Math.floor(this.now() / 60_000);
    for (const { key, value } of await this.store.list<ShipmentRecord>("shipment")) {
      if (TERMINAL_STATUSES.has(value.shipment.status)) continue;
      await this.enqueue("bosta.ingestStatus", { trackingNumber: key }, `bosta:poll:${key}:${slot}`);
    }
  }

  private onOutcome(o: JobOutcome) {
    if (o.type === "dead") {
      const kind = o.error instanceof IntegrationError ? o.error.kind : "permanent";
      this.emit("job.dead", { jobId: o.job.id, job: o.job.kind, errorKind: kind, error: o.error.message, payload: o.job.payload as Record<string, unknown> });
      if (kind === "auth" || kind === "permission") this.emit("connection.needs_attention", { connector: (o.error as IntegrationError).connector, reason: o.error.message });
      // An offer that never made it into the store's order: the team adds it by hand.
      if (o.job.kind === "shopify.addOffer" && kind !== "auth" && kind !== "permission") {
        const p = o.job.payload as OfferJob;
        this.runHook(() => this.opts.hooks?.onOfferResult?.(p.offerId, { ok: false, reason: "failed", message: o.error.message }))
          .catch((e) => this.rt.logger.log("error", "offer result hook failed", { offerId: p.offerId, error: e instanceof Error ? e.message : String(e) }));
      }
    }
  }
}

/** The order fields that drive engine decisions (shipping, payment, cancellation). */
/**
 * An order without personal data, as the engine keeps it in its records (E2-8, docs/07): no
 * customer name, phone or email, and of the address only the city, province and country (the
 * courier's zone). Mizan's own tables keep the rest, encrypted.
 */
export function withoutPersonalData(o: CanonicalOrder): CanonicalOrder {
  const a = o.shippingAddress;
  return {
    ...o, raw: undefined, customer: { name: "" },
    ...(a ? { shippingAddress: { line1: "", city: a.city, countryCode: a.countryCode, ...(a.province ? { province: a.province } : {}) } } : {}),
  };
}

function orderFingerprint(o: CanonicalOrder): string {
  return [o.updatedAt, o.paymentMode, o.paymentStatus, o.outstanding?.amount ?? "", o.refunded?.amount ?? "", o.cancelled ? 1 : 0, [...o.tags].sort().join(",")].join("|");
}

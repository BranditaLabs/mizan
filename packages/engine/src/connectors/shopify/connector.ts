import { IntegrationError } from "../../core/errors.js";
import type { CanonicalOrder, CanonicalProduct, ProductPatch } from "@mizan/shared";
import type { Runtime } from "../../core/runtime.js";
import type { DriftSink } from "../../adapt/drift.js";
import { Resolver } from "../../adapt/resolve.js";
import type { ShapeWatch } from "../../adapt/shape.js";
import { assertNoUserErrors, ShopifyGraphql, type ShopifyCredentials } from "./client.js";
import { mapOrder, mapProduct } from "./mapper.js";
import * as Q from "./queries.js";

type UserErrors = Array<{ field?: string[] | null; message: string; code?: string | null }>;

export interface Tracking {
  company: string;
  number: string;
  url?: string;
}

/**
 * Shopify connector: everything Mizan reads from or writes to a Shopify store.
 * Writes are designed to be safe to repeat:
 *   - prices and product fields are absolute values (setting twice = same result)
 *   - inventory uses compare-and-set + Shopify's idempotency key
 *   - fulfillments are checked for the tracking number before creating
 *   - marking paid is skipped when the order is already paid
 */
export interface ShopifyLearned {
  variants: Record<string, number>;
  inventoryCompareField: "changeFromQuantity" | "compareQuantity";
}

/** Shopify's OrderCancelReason. */
export type CancelReason = "CUSTOMER" | "DECLINED" | "FRAUD" | "INVENTORY" | "OTHER" | "STAFF";

export class ShopifyConnector {
  readonly id = "shopify";
  readonly gql: ShopifyGraphql;
  /** Which compare field Shopify accepts on inventorySetQuantities; learned on first schema rejection. */
  private inventoryCompareField: "changeFromQuantity" | "compareQuantity" = "changeFromQuantity";

  constructor(readonly creds: ShopifyCredentials, private readonly rt: Runtime, private readonly drift: DriftSink, shapes: ShapeWatch, private readonly opts: { codPatterns?: RegExp[] } = {}) {
    this.gql = new ShopifyGraphql(creds, rt, drift, shapes);
  }

  /** What this connector learned about the shop's API (query variants, inventory compare field). */
  exportLearned(): ShopifyLearned {
    return { variants: this.gql.exportVariants(), inventoryCompareField: this.inventoryCompareField };
  }

  loadLearned(state: Partial<ShopifyLearned> | undefined) {
    this.gql.loadVariants(state?.variants);
    if (state?.inventoryCompareField === "compareQuantity" || state?.inventoryCompareField === "changeFromQuantity") {
      this.inventoryCompareField = state.inventoryCompareField;
    }
  }

  private ctx() {
    return { drift: this.drift, now: () => this.rt.clock.now(), codPatterns: this.opts.codPatterns };
  }

  // ───────────── reads ─────────────

  async getOrder(id: string): Promise<CanonicalOrder> {
    const data = await this.gql.run<{ order: unknown }>(Q.ORDER_BY_ID, { id }, { idempotent: true });
    if (!data.order) throw new IntegrationError({ kind: "not_found", connector: "shopify", message: `order ${id} not found` });
    return mapOrder(data.order, this.ctx());
  }

  async *ordersUpdatedSince(sinceIso: string, pageSize = 50): AsyncGenerator<CanonicalOrder[]> {
    let after: string | null = null;
    do {
      const page = await this.ordersPage(`updated_at:>='${sinceIso}'`, after, pageSize);
      yield page.nodes;
      after = page.next;
    } while (after);
  }

  /** One page of orders matching a Shopify search query, oldest update first; `next` is null on the last page. */
  async ordersPage(query: string | null, after: string | null, pageSize = 50): Promise<{ nodes: CanonicalOrder[]; next: string | null }> {
    const data: { orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: unknown[] } } =
      await this.gql.run(Q.ORDERS_UPDATED, { first: pageSize, after, query }, { idempotent: true });
    return { nodes: data.orders.nodes.map((n) => mapOrder(n, this.ctx())), next: data.orders.pageInfo.hasNextPage ? data.orders.pageInfo.endCursor : null };
  }

  async getProduct(id: string): Promise<CanonicalProduct> {
    const data = await this.gql.run<{ product: unknown }>(Q.PRODUCT_BY_ID, { id }, { idempotent: true });
    if (!data.product) throw new IntegrationError({ kind: "not_found", connector: "shopify", message: `product ${id} not found` });
    return mapProduct(data.product, this.ctx());
  }

  async *productsUpdatedSince(sinceIso: string, pageSize = 50): AsyncGenerator<CanonicalProduct[]> {
    let after: string | null = null;
    do {
      const page = await this.productsPage(`updated_at:>='${sinceIso}'`, after, pageSize);
      yield page.nodes;
      after = page.next;
    } while (after);
  }

  async productsPage(query: string | null, after: string | null, pageSize = 50): Promise<{ nodes: CanonicalProduct[]; next: string | null }> {
    const data: { products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: unknown[] } } =
      await this.gql.run(Q.PRODUCTS_UPDATED, { first: pageSize, after, query }, { idempotent: true });
    return { nodes: data.products.nodes.map((n) => mapProduct(n, this.ctx())), next: data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null };
  }

  async getAvailable(inventoryItemId: string, locationId: string): Promise<number> {
    const data = await this.gql.run(Q.INVENTORY_LEVEL, { id: inventoryItemId, locationId }, { idempotent: true });
    const r = new Resolver(data, { connector: "shopify", entity: "inventoryLevel", drift: this.drift, now: () => this.rt.clock.now() });
    const q = r.arr<{ name: string; quantity: number }>("quantities", ["inventoryItem.inventoryLevel.quantities"]);
    const avail = q.find((x) => x.name === "available");
    if (!avail) throw new IntegrationError({ kind: "not_found", connector: "shopify", message: `no inventory level for ${inventoryItemId} at ${locationId}` });
    return Number(avail.quantity);
  }

  // ───────────── writes ─────────────

  /**
   * Apply a product patch. Product fields, variant prices and inventory go
   * through their own mutations; only the parts present in the patch are sent.
   * `opKey` makes the inventory write idempotent at Shopify across retries.
   */
  async applyProductPatch(patch: ProductPatch, opKey: string): Promise<void> {
    const productFields: Record<string, unknown> = {};
    if (patch.title !== undefined) productFields.title = patch.title;
    if (patch.descriptionHtml !== undefined) productFields.descriptionHtml = patch.descriptionHtml;
    if (patch.tags !== undefined) productFields.tags = patch.tags;
    if (patch.status !== undefined && patch.status !== "unknown") productFields.status = patch.status.toUpperCase();
    if (Object.keys(productFields).length) {
      const d = await this.gql.run<{ productUpdate: { userErrors: UserErrors } }>(Q.PRODUCT_UPDATE, { product: { id: patch.productExternalId, ...productFields } }, { idempotent: true });
      assertNoUserErrors("productUpdate", d.productUpdate?.userErrors);
    }

    if (patch.variants?.length) {
      const variants = patch.variants.map((v) => ({
        id: v.externalId,
        ...(v.price ? { price: v.price.amount } : {}),
        ...(v.compareAtPrice !== undefined ? { compareAtPrice: v.compareAtPrice ? v.compareAtPrice.amount : null } : {}),
      }));
      const d = await this.gql.run<{ productVariantsBulkUpdate: { userErrors: UserErrors } }>(Q.VARIANTS_UPDATE, { productId: patch.productExternalId, variants }, { idempotent: true });
      assertNoUserErrors("productVariantsBulkUpdate", d.productVariantsBulkUpdate?.userErrors);
    }

    for (const [i, inv] of (patch.inventory ?? []).entries()) {
      await this.setAvailable(inv.inventoryItemId, inv.locationId, inv.available, `${opKey}:inv:${i}`);
    }
  }

  /**
   * Compare-and-set inventory. Reads the current quantity, sends the new
   * absolute value with that quantity as the compare value. If someone else
   * changed stock in between, Shopify rejects it; we re-read and try again.
   */
  async setAvailable(inventoryItemId: string, locationId: string, available: number, idempotencyKey: string, maxConflicts = 3): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      const current = await this.getAvailable(inventoryItemId, locationId);
      if (current === available) return; // already there: nothing to write
      const quantity = { inventoryItemId, locationId, quantity: available, [this.inventoryCompareField]: current };
      try {
        const d = await this.gql.run<{ inventorySetQuantities: { userErrors: UserErrors } }>(Q.INVENTORY_SET, {
          input: { name: "available", reason: "correction", referenceDocumentUri: `mizan://inventory/${encodeURIComponent(idempotencyKey)}`, quantities: [quantity] },
          idempotencyKey: `${idempotencyKey}:${attempt}`,
        }, { idempotent: true });
        assertNoUserErrors("inventorySetQuantities", d.inventorySetQuantities?.userErrors);
        return;
      } catch (e) {
        if (e instanceof IntegrationError && e.kind === "schema_drift" && this.inventoryCompareField === "changeFromQuantity" && /changeFromQuantity/i.test(e.message)) {
          this.inventoryCompareField = "compareQuantity";
          this.drift.record({ connector: "shopify", entity: "inventorySetQuantities", kind: "fallback_field", field: "changeFromQuantity", detail: "switched to compareQuantity", at: this.rt.clock.now() });
          continue;
        }
        if (e instanceof IntegrationError && e.kind === "conflict" && attempt + 1 < maxConflicts) continue;
        throw e;
      }
    }
  }

  /**
   * Create a fulfillment with tracking. Not naturally idempotent, so it first
   * checks whether a fulfillment with this tracking number already exists
   * (a previous attempt may have succeeded before a timeout).
   */
  async fulfillWithTracking(orderId: string, tracking: Tracking, notifyCustomer = true): Promise<"created" | "already_fulfilled"> {
    const raw = await this.gql.run<{ order: Record<string, unknown> | null }>(Q.ORDER_BY_ID, { id: orderId }, { idempotent: true });
    if (!raw.order) throw new IntegrationError({ kind: "not_found", connector: "shopify", message: `order ${orderId} not found` });
    const r = new Resolver(raw.order, { connector: "shopify", entity: "order", drift: this.drift, now: () => this.rt.clock.now() });
    const existing = r.arr<{ trackingInfo?: Array<{ number?: string }> }>("fulfillments", ["fulfillments"]);
    if (existing.some((f) => (f.trackingInfo ?? []).some((t) => t.number === tracking.number))) return "already_fulfilled";

    const open = r.arr<{ id: string; status: string }>("fulfillmentOrders", ["fulfillmentOrders"]).filter((fo) => /^(OPEN|IN_PROGRESS|SCHEDULED)$/i.test(fo.status));
    if (!open.length) {
      throw new IntegrationError({ kind: "validation", connector: "shopify", message: `order ${orderId} has no open fulfillment orders (already fulfilled, cancelled, or app lacks fulfillment scopes)` });
    }
    const d = await this.gql.run<{ fulfillmentCreate: { userErrors: UserErrors } }>(Q.FULFILLMENT_CREATE, {
      fulfillment: {
        lineItemsByFulfillmentOrder: open.map((fo) => ({ fulfillmentOrderId: fo.id })),
        trackingInfo: { company: tracking.company, number: tracking.number, ...(tracking.url ? { url: tracking.url } : {}) },
        notifyCustomer,
      },
    }, { idempotent: false });
    assertNoUserErrors("fulfillmentCreate", d.fulfillmentCreate?.userErrors);
    return "created";
  }

  async markPaid(orderId: string): Promise<"marked" | "already_paid"> {
    const order = await this.getOrder(orderId);
    if (order.financialStatus && /^PAID$/i.test(order.financialStatus)) return "already_paid";
    const d = await this.gql.run<{ orderMarkAsPaid: { userErrors: UserErrors } }>(Q.ORDER_MARK_PAID, { input: { id: orderId } }, { idempotent: true });
    const errs = d.orderMarkAsPaid?.userErrors ?? [];
    if (errs.some((e) => /already.*paid|cannot be marked as paid/i.test(e.message))) return "already_paid";
    assertNoUserErrors("orderMarkAsPaid", errs);
    return "marked";
  }

  /**
   * Add an accepted offer to the customer's order (E6-13) through Shopify's order edit. Safe to
   * repeat: it reads first and stops if the order already carries the offer (its marker tag, or
   * the item's line already there after a commit whose response was lost); the commit itself is
   * not idempotent, so a timeout is verified by reading the order again, never re-sent blindly.
   * The marker tag goes on last. Throws `validation` for an order that cannot take it (cancelled,
   * item sold out or gone).
   */
  async addOfferToOrder(o: { orderId: string; variantId: string; qty: number; discountPct: string; marker: string; note: string }): Promise<"added" | "already_added"> {
    const tag = `mizan-offer-${o.marker}`;
    const state = async () => {
      const raw = await this.gql.run<{ order: Record<string, unknown> | null }>(Q.ORDER_BY_ID, { id: o.orderId }, { idempotent: true });
      if (!raw.order) throw new IntegrationError({ kind: "not_found", connector: "shopify", message: `order ${o.orderId} not found` });
      const r = new Resolver(raw.order, { connector: "shopify", entity: "order", drift: this.drift, now: () => this.rt.clock.now() });
      const lines = r.arr("lineItems", ["lineItems"]).map((li) => {
        const lr = r.child(li, "order.lineItem");
        return { variantId: lr.str("variantId", ["variant.id", "variantId"]), quantity: lr.num("quantity", ["currentQuantity", "quantity"]) ?? 0 };
      });
      return {
        tagged: r.arr<string>("tags", ["tags"]).includes(tag),
        hasLine: lines.some((l) => l.variantId === o.variantId && l.quantity >= o.qty),
        cancelled: Boolean(r.str("cancelledAt", ["cancelledAt"])),
      };
    };
    const before = await state();
    if (before.tagged) return "already_added";
    if (before.hasLine) { await this.addTags(o.orderId, [tag]); return "already_added"; }
    if (before.cancelled) throw new IntegrationError({ kind: "validation", connector: "shopify", message: `order ${o.orderId} is cancelled` });

    const begin = await this.gql.run<{ orderEditBegin: { calculatedOrder?: { id: string } | null; userErrors: UserErrors } }>(Q.ORDER_EDIT_BEGIN, { id: o.orderId }, { idempotent: true });
    assertNoUserErrors("orderEditBegin", begin.orderEditBegin?.userErrors);
    const calc = begin.orderEditBegin?.calculatedOrder?.id;
    if (!calc) throw new IntegrationError({ kind: "schema_drift", connector: "shopify", message: "orderEditBegin: no calculatedOrder.id" });
    // Adding to an uncommitted edit changes nothing in the store: safe to repeat.
    const add = await this.gql.run<{ orderEditAddVariant: { calculatedLineItem?: { id: string } | null; userErrors: UserErrors } }>(Q.ORDER_EDIT_ADD_VARIANT, { id: calc, variantId: o.variantId, quantity: o.qty }, { idempotent: true });
    assertNoUserErrors("orderEditAddVariant", add.orderEditAddVariant?.userErrors);
    const line = add.orderEditAddVariant?.calculatedLineItem?.id;
    if (!line) throw new IntegrationError({ kind: "schema_drift", connector: "shopify", message: "orderEditAddVariant: no calculatedLineItem.id" });
    if (Number(o.discountPct) > 0) {
      const d = await this.gql.run<{ orderEditAddLineItemDiscount: { userErrors: UserErrors } }>(Q.ORDER_EDIT_ADD_DISCOUNT, {
        id: calc, lineItemId: line, discount: { percentValue: Number(o.discountPct), description: o.note },
      }, { idempotent: true });
      assertNoUserErrors("orderEditAddLineItemDiscount", d.orderEditAddLineItemDiscount?.userErrors);
    }
    try {
      const c = await this.gql.run<{ orderEditCommit: { userErrors: UserErrors } }>(Q.ORDER_EDIT_COMMIT, { id: calc, notifyCustomer: false, staffNote: o.note }, { idempotent: false });
      assertNoUserErrors("orderEditCommit", c.orderEditCommit?.userErrors);
    } catch (err) {
      // The commit may have gone through before the response was lost: look before anything else.
      if (!(err instanceof IntegrationError) || err.kind !== "timeout") throw err;
      const after = await state();
      if (!after.hasLine && !after.tagged) throw new IntegrationError({ kind: "transient", connector: "shopify", message: "orderEditCommit timed out and the order has no new line: will start the edit again", cause: err });
    }
    await this.addTags(o.orderId, [tag]);
    return "added";
  }

  /**
   * Cancel the store's order (E5-4), once: an order already cancelled is left alone; the mutation is
   * not idempotent, so a timeout is checked by reading the order before anything is sent again.
   * Never refunds, never notifies the customer, restocks.
   */
  async cancelOrder(o: { orderId: string; reason: CancelReason; note?: string | undefined }): Promise<"cancelled" | "already_cancelled"> {
    if ((await this.getOrder(o.orderId)).cancelled) return "already_cancelled";
    try {
      const d = await this.gql.run<{ orderCancel: { orderCancelUserErrors?: UserErrors; userErrors?: UserErrors } }>(
        Q.ORDER_CANCEL, { orderId: o.orderId, reason: o.reason, staffNote: o.note ?? null }, { idempotent: false });
      const errs = [...(d.orderCancel?.orderCancelUserErrors ?? []), ...(d.orderCancel?.userErrors ?? [])];
      if (errs.some((e) => /already.*cancel/i.test(e.message))) return "already_cancelled";
      assertNoUserErrors("orderCancel", errs);
    } catch (err) {
      if (!(err instanceof IntegrationError) || err.kind !== "timeout") throw err;
      if (!(await this.getOrder(o.orderId)).cancelled) {
        throw new IntegrationError({ kind: "transient", connector: "shopify", message: "orderCancel timed out and the order is not cancelled: will try again", cause: err });
      }
    }
    return "cancelled";
  }

  async addTags(id: string, tags: string[]): Promise<void> {
    const d = await this.gql.run<{ tagsAdd: { userErrors: UserErrors } }>(Q.TAGS_ADD, { id, tags }, { idempotent: true });
    assertNoUserErrors("tagsAdd", d.tagsAdd?.userErrors);
  }

  // ───────────── webhooks ─────────────

  /**
   * Make this app's subscriptions on the shop exactly `topics` → `uri`: delete ours that point
   * elsewhere (old URL, old connection) or at topics we no longer want, create the missing ones.
   * Safe to repeat: Shopify refuses a second subscription for the same topic and address.
   * Compliance topics (customers/redact …) are app configuration, not subscriptions.
   */
  async syncWebhooks(uri: string, topics: readonly string[]): Promise<{ created: string[]; deleted: number; kept: number }> {
    const d = await this.gql.run<Record<string, unknown>>(Q.WEBHOOK_SUBSCRIPTIONS, { first: 100 }, { idempotent: true });
    const nodes = (new Resolver(d, { connector: "shopify", entity: "webhook_subscriptions", ...this.ctx() }).any("nodes", ["webhookSubscriptions.nodes"]) ?? []) as unknown[];
    const existing = nodes.map((n) => {
      const r = new Resolver(n, { connector: "shopify", entity: "webhook_subscription", ...this.ctx() });
      return { id: r.str("id", ["id"], { required: true })!, topic: r.str("topic", ["topic"], { required: true })!, uri: r.str("uri", ["uri", "endpoint.callbackUrl", "callbackUrl"]) };
    });
    let deleted = 0;
    for (const e of existing.filter((x) => x.uri !== uri || !topics.includes(x.topic))) {
      const res = await this.gql.run<{ webhookSubscriptionDelete: { userErrors: UserErrors } }>(Q.WEBHOOK_DELETE, { id: e.id }, { idempotent: true });
      const errs = (res.webhookSubscriptionDelete?.userErrors ?? []).filter((x) => !/not.*found|does not exist/i.test(x.message));
      assertNoUserErrors("webhookSubscriptionDelete", errs);
      deleted++;
    }
    const created: string[] = [];
    for (const topic of topics.filter((t) => !existing.some((x) => x.topic === t && x.uri === uri))) {
      const res = await this.gql.run<{ webhookSubscriptionCreate: { userErrors: UserErrors } }>(Q.WEBHOOK_CREATE, { topic, sub: { uri, format: "JSON" } }, { idempotent: true });
      const errs = (res.webhookSubscriptionCreate?.userErrors ?? []).filter((x) => !/already been taken|already exists/i.test(x.message));
      assertNoUserErrors("webhookSubscriptionCreate", errs);
      created.push(topic);
    }
    return { created, deleted, kept: existing.length - deleted };
  }

  health() {
    return { circuit: this.gql.circuit.status, budget: this.gql.bucket.snapshot };
  }
}

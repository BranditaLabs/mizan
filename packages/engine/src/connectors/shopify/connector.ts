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
    for (;;) {
      const data: { orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: unknown[] } } =
        await this.gql.run(Q.ORDERS_UPDATED, { first: pageSize, after, query: `updated_at:>='${sinceIso}'` }, { idempotent: true });
      yield data.orders.nodes.map((n) => mapOrder(n, this.ctx()));
      if (!data.orders.pageInfo.hasNextPage) return;
      after = data.orders.pageInfo.endCursor;
    }
  }

  async getProduct(id: string): Promise<CanonicalProduct> {
    const data = await this.gql.run<{ product: unknown }>(Q.PRODUCT_BY_ID, { id }, { idempotent: true });
    if (!data.product) throw new IntegrationError({ kind: "not_found", connector: "shopify", message: `product ${id} not found` });
    return mapProduct(data.product, this.ctx());
  }

  async *productsUpdatedSince(sinceIso: string, pageSize = 50): AsyncGenerator<CanonicalProduct[]> {
    let after: string | null = null;
    for (;;) {
      const data: { products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: unknown[] } } =
        await this.gql.run(Q.PRODUCTS_UPDATED, { first: pageSize, after, query: `updated_at:>='${sinceIso}'` }, { idempotent: true });
      yield data.products.nodes.map((n) => mapProduct(n, this.ctx()));
      if (!data.products.pageInfo.hasNextPage) return;
      after = data.products.pageInfo.endCursor;
    }
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

  async addTags(id: string, tags: string[]): Promise<void> {
    const d = await this.gql.run<{ tagsAdd: { userErrors: UserErrors } }>(Q.TAGS_ADD, { id, tags }, { idempotent: true });
    assertNoUserErrors("tagsAdd", d.tagsAdd?.userErrors);
  }

  health() {
    return { circuit: this.gql.circuit.status, budget: this.gql.bucket.snapshot };
  }
}

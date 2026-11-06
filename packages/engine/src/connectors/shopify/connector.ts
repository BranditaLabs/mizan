import { mizanOrderRef, type StoreOrderDraft } from "../../core/store-order.js";
import { editMarker, type OrderEditPlan } from "../../core/order-edit.js";
import type { CreatedProduct, ProductDraft } from "../../core/product-draft.js";
import { IntegrationError } from "../../core/errors.js";
import { findRegion, type CanonicalOrder, type CanonicalProduct, type ProductPatch } from "@mizan/shared";
import type { Runtime } from "../../core/runtime.js";
import type { DriftSink } from "../../adapt/drift.js";
import { Resolver } from "../../adapt/resolve.js";
import type { ShapeWatch } from "../../adapt/shape.js";
import { assertNoUserErrors, ShopifyGraphql, type ShopifyCredentials, costRefusal } from "./client.js";
import { mapOrder, mapProduct } from "./mapper.js";
import * as Q from "./queries.js";

type UserErrors = Array<{ field?: string[] | null; message: string; code?: string | null }>;

const MIZAN_ID = { namespace: "$app:mizan", key: "order_id" } as const;

/** The store as Shopify knows it (onboarding): the merchant never types what the store already says. */
export interface ShopProfile {
  name: string;
  domain?: string;
  url?: string;
  currency?: string;
  timezone?: string;
  country?: string;
  logoUrl?: string;
  squareLogoUrl?: string;
  brandColor?: string;
  /** The Storefront brand was read, the app may not read it (scope not granted yet), or none is set in Shopify. */
  brand: "read" | "no_access" | "none";
}

const STOREFRONT_TOKEN_TITLE = "Mizan brand";

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
/** Shopify's FulfillmentEventStatus values Mizan sends (E7-7). */
export type FulfillmentEventStatus = "CARRIER_PICKED_UP" | "IN_TRANSIT" | "OUT_FOR_DELIVERY" | "ATTEMPTED_DELIVERY" | "DELIVERED" | "FAILURE" | "DELAYED";

export type CancelReason = "CUSTOMER" | "DECLINED" | "FRAUD" | "INVENTORY" | "OTHER" | "STAFF";

/** Shopify's refusal of a webhook topic for an app without protected customer data approval. */
const PROTECTED_DATA = /not approved to subscribe to webhook topics containing protected customer data/i;

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
      await this.fitting("orders", pageSize, (first) => this.gql.run(Q.ORDERS_UPDATED, { first, after, query }, { idempotent: true }));
    return { nodes: data.orders.nodes.map((n) => mapOrder(n, this.ctx())), next: data.orders.pageInfo.hasNextPage ? data.orders.pageInfo.endCursor : null };
  }

  /** Page sizes Shopify accepted for this shop, learned when a bigger page cost too much. */
  private readonly fits = new Map<string, number>();

  /**
   * A page that fits Shopify's limit of 1,000 per query. A shop with many variants or order lines
   * makes a full page cost more: Shopify says by how much, the page shrinks to fit (with room to
   * spare), and the size is kept for the next pages. One item that still costs too much is an error.
   */
  private async fitting<T>(what: string, wanted: number, run: (first: number) => Promise<T>): Promise<T> {
    let first = Math.min(wanted, this.fits.get(what) ?? wanted);
    for (;;) {
      try {
        return await run(first);
      } catch (e) {
        const refusal = costRefusal(e);
        if (refusal === false || first <= 1) throw e;
        const next = refusal ? Math.max(1, Math.floor((first * refusal.max * 0.8) / refusal.cost)) : Math.max(1, Math.floor(first / 2));
        first = Math.min(next, first - 1);
        this.fits.set(what, first);
        this.drift.record({ connector: "shopify", entity: what, kind: "fallback_field", detail: `page too expensive for this shop: now ${first} per page`, at: this.rt.clock.now() });
      }
    }
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
      await this.fitting("products", pageSize, (first) => this.gql.run(Q.PRODUCTS_UPDATED, { first, after, query }, { idempotent: true }));
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
    if (patch.vendor !== undefined) productFields.vendor = patch.vendor;
    if (patch.productType !== undefined) productFields.productType = patch.productType;
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

    if (patch.mediaOrder?.length) {
      const moves = patch.mediaOrder.map((id, newPosition) => ({ id, newPosition: String(newPosition) }));
      const d = await this.gql.run<{ productReorderMedia: { mediaUserErrors?: UserErrors } }>(Q.PRODUCT_REORDER_MEDIA, { id: patch.productExternalId, moves }, { idempotent: true });
      assertNoUserErrors("productReorderMedia", d.productReorderMedia?.mediaUserErrors);
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
  /**
   * The store's profile: name, currency, timezone and country from the Admin API, logo and colour
   * from the Storefront API (Admin has no logo). Without the storefront scope the profile still
   * comes back, with brand "no_access"; a later read (after the merchant approves it) fills the logo.
   */
  async shopProfile(): Promise<ShopProfile> {
    const raw = await this.gql.run<{ shop?: unknown }>(Q.SHOP_PROFILE, {}, { idempotent: true });
    const r = new Resolver(raw.shop, { connector: "shopify", entity: "shop", drift: this.drift, now: () => this.rt.clock.now() });
    const profile: ShopProfile = {
      name: r.str("name", ["name"], { required: true })!,
      domain: r.str("domain", ["myshopifyDomain"]),
      url: r.str("url", ["primaryDomain.url"]),
      currency: r.str("currency", ["currencyCode"]),
      timezone: r.str("timezone", ["ianaTimezone"]),
      country: r.str("country", ["billingAddress.countryCodeV2", "billingAddress.countryCode"]),
      brand: "none",
    };
    try {
      const token = await this.storefrontToken();
      const b = await this.gql.storefront<{ shop?: unknown }>(Q.STOREFRONT_BRAND, token);
      const rb = new Resolver(b.shop, { connector: "shopify", entity: "brand", drift: this.drift, now: () => this.rt.clock.now() });
      profile.logoUrl = rb.str("logo", ["brand.logo.image.url"]);
      profile.squareLogoUrl = rb.str("squareLogo", ["brand.squareLogo.image.url"]);
      profile.brandColor = rb.str("color", ["brand.colors.primary.0.background"]);
      profile.brand = profile.logoUrl || profile.squareLogoUrl ? "read" : "none";
    } catch (e) {
      // Scope not granted (or a storefront token refused): the profile still counts, the logo comes later.
      if (!(e instanceof IntegrationError) || !["permission", "auth", "not_found"].includes(e.kind)) throw e;
      profile.brand = "no_access";
    }
    return profile;
  }

  /** The app's Storefront token on this shop: looked up before one is created, so a retried create never makes two. */
  private async storefrontToken(): Promise<string> {
    const list = await this.gql.run<{ shop?: unknown }>(Q.STOREFRONT_TOKENS, {}, { idempotent: true });
    const r = new Resolver(list.shop, { connector: "shopify", entity: "storefront_token", drift: this.drift, now: () => this.rt.clock.now() });
    const found = r.arr<{ title?: string; accessToken?: string }>("tokens", ["storefrontAccessTokens.nodes"]).find((t) => t.title === STOREFRONT_TOKEN_TITLE && t.accessToken);
    if (found?.accessToken) return found.accessToken;
    // Not idempotent: one attempt; an unknown outcome fails the job and the retry finds the token by its title.
    const c = await this.gql.run<{ storefrontAccessTokenCreate?: { storefrontAccessToken?: { accessToken?: string } | null; userErrors: UserErrors } }>(
      Q.STOREFRONT_TOKEN_CREATE, { input: { title: STOREFRONT_TOKEN_TITLE } }, { idempotent: false, maxAttempts: 1 });
    assertNoUserErrors("storefrontAccessTokenCreate", c.storefrontAccessTokenCreate?.userErrors);
    const token = c.storefrontAccessTokenCreate?.storefrontAccessToken?.accessToken;
    if (!token) throw new IntegrationError({ kind: "transient", connector: "shopify", message: "storefrontAccessTokenCreate returned no token" });
    return token;
  }

  /** Cancel the order's fulfillment carrying this tracking number (safe to repeat: a cancelled or missing one is done). */
  async cancelFulfillment(orderId: string, trackingNumber: string): Promise<"cancelled" | "already_cancelled"> {
    const order = await this.getOrder(orderId);
    const f = (order.storeFulfillments ?? []).find((x) => x.trackingNumber === trackingNumber && x.status !== "CANCELLED");
    if (!f) return "already_cancelled";
    const r = await this.gql.run<{ fulfillmentCancel: { userErrors: UserErrors } }>(Q.FULFILLMENT_CANCEL, { id: f.externalId }, { idempotent: true });
    assertNoUserErrors("fulfillmentCancel", r.fulfillmentCancel?.userErrors);
    return "cancelled";
  }

  /**
   * Already there (this number on a fulfillment) is done; a live one without the link, or with another,
   * gets the link (absolute, so safe to repeat). A cancelled one stays cancelled: the merchant undid it.
   * A fulfillment carrying other parcels' numbers too is left alone (the update would drop them).
   */
  async fulfillWithTracking(orderId: string, tracking: Tracking, notifyCustomer = true): Promise<"created" | "already_fulfilled" | "link_updated"> {
    const raw = await this.gql.run<{ order: Record<string, unknown> | null }>(Q.ORDER_BY_ID, { id: orderId }, { idempotent: true });
    if (!raw.order) throw new IntegrationError({ kind: "not_found", connector: "shopify", message: `order ${orderId} not found` });
    const r = new Resolver(raw.order, { connector: "shopify", entity: "order", drift: this.drift, now: () => this.rt.clock.now() });
    const existing = r.arr<{ id?: string; status?: string; trackingInfo?: Array<{ number?: string; company?: string | null; url?: string | null }> }>("fulfillments", ["fulfillments"]);
    const same = existing.find((f) => (f.trackingInfo ?? []).some((t) => t.number === tracking.number));
    if (same) {
      const info = (same.trackingInfo ?? []).find((t) => t.number === tracking.number);
      if (!tracking.url || same.status === "CANCELLED" || !same.id || info?.url === tracking.url) return "already_fulfilled";
      // The update replaces the fulfillment's whole tracking: one with other parcels' numbers is left as it is.
      if ((same.trackingInfo ?? []).length > 1) {
        this.drift.record({ connector: "shopify", entity: "fulfillment", kind: "missing_field", detail: `order ${orderId}: ${tracking.number} has no link, but its fulfillment carries other numbers too; left as it is`, at: this.rt.clock.now() });
        return "already_fulfilled";
      }
      // notifyCustomer also decides the fulfillment's later updates: kept as the caller wants them (on, by default).
      const u = await this.gql.run<{ fulfillmentTrackingInfoUpdate: { userErrors: UserErrors } }>(Q.FULFILLMENT_TRACKING_UPDATE, {
        fulfillmentId: same.id, trackingInfoInput: { company: info?.company || tracking.company, number: tracking.number, url: tracking.url }, notifyCustomer,
      }, { idempotent: true });
      assertNoUserErrors("fulfillmentTrackingInfoUpdate", u.fulfillmentTrackingInfoUpdate?.userErrors);
      return "link_updated";
    }

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

  /**
   * One courier step on the order's fulfillment (E7-7): the fulfillment carrying this tracking number
   * gets the event once. The write is not idempotent, so the fulfillment's events are read first (same
   * status at the same time, or any DELIVERED, means it is there) and a timeout is verified by reading
   * again. No fulfillment yet (its own job still running) is transient: the job waits for it. A store
   * whose API version does not know CARRIER_PICKED_UP gets IN_TRANSIT instead, recorded as drift.
   */
  async addFulfillmentEvent(e: { orderId: string; trackingNumber: string; status: FulfillmentEventStatus; happenedAt: string; message?: string }): Promise<"created" | "already_recorded"> {
    const raw = await this.gql.run<{ order: Record<string, unknown> | null }>(Q.ORDER_BY_ID, { id: e.orderId }, { idempotent: true });
    if (!raw.order) throw new IntegrationError({ kind: "not_found", connector: "shopify", message: `order ${e.orderId} not found` });
    const r = new Resolver(raw.order, { connector: "shopify", entity: "order", drift: this.drift, now: () => this.rt.clock.now() });
    const fulfillment = r.arr<{ id?: string; trackingInfo?: Array<{ number?: string }> }>("fulfillments", ["fulfillments"])
      .find((f) => (f.trackingInfo ?? []).some((t) => t.number === e.trackingNumber));
    if (!fulfillment?.id) {
      throw new IntegrationError({ kind: "transient", connector: "shopify", message: `order ${e.orderId} has no fulfillment for ${e.trackingNumber} yet` });
    }
    const at = Date.parse(e.happenedAt);
    const recorded = async (status: FulfillmentEventStatus) => {
      const d = await this.gql.run<{ fulfillment: Record<string, unknown> | null }>(Q.FULFILLMENT_EVENTS, { id: fulfillment.id }, { idempotent: true });
      if (!d.fulfillment) throw new IntegrationError({ kind: "not_found", connector: "shopify", message: `fulfillment ${fulfillment.id} not found` });
      const fr = new Resolver(d.fulfillment, { connector: "shopify", entity: "fulfillment", drift: this.drift, now: () => this.rt.clock.now() });
      const events = fr.arr<{ status?: string; happenedAt?: string }>("events", ["events.nodes", "events"]);
      return events.some((x) => x.status === status && (status === "DELIVERED" || Math.abs(Date.parse(x.happenedAt ?? "") - at) < 1_000));
    };
    let status = e.status;
    for (;;) {
      if (await recorded(status)) return "already_recorded";
      try {
        const d = await this.gql.run<{ fulfillmentEventCreate: { userErrors: UserErrors } }>(Q.FULFILLMENT_EVENT_CREATE, {
          fulfillmentEvent: { fulfillmentId: fulfillment.id, status, happenedAt: new Date(at).toISOString(), ...(e.message ? { message: e.message } : {}) },
        }, { idempotent: false });
        assertNoUserErrors("fulfillmentEventCreate", d.fulfillmentEventCreate?.userErrors);
        return "created";
      } catch (err) {
        if (err instanceof IntegrationError && status === "CARRIER_PICKED_UP" && (err.kind === "validation" || err.kind === "schema_drift") && /CARRIER_PICKED_UP/.test(err.message)) {
          this.drift.record({ connector: "shopify", entity: "fulfillmentEvent", kind: "fallback_field", field: "status", detail: "CARRIER_PICKED_UP not accepted; sent IN_TRANSIT", at: this.rt.clock.now() });
          status = "IN_TRANSIT";
          continue;
        }
        if (!(err instanceof IntegrationError) || err.kind !== "timeout") throw err;
        if (await recorded(status)) return "created";
        throw new IntegrationError({ kind: "transient", connector: "shopify", message: "fulfillmentEventCreate timed out and the event is not there: will try again", cause: err });
      }
    }
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
   * Publish a product made in Mizan (P3), once: found by its handle first (an earlier attempt that
   * created it, its answer lost), else created; then the variants it does not have yet — all of them
   * in place of the one Shopify makes with the product, or only the missing ones on a retry. The
   * create mutations are not idempotent: each is preceded by a read, and a lost answer is read again.
   * Returns the store's product, variant (by Mizan id) and picture ids (by Mizan id, in order).
   */
  /**
   * An order made in Mizan, created in the store once. Mizan's id goes in a unique order metafield:
   * the order is found by it first (a direct read), a second create with it is refused by the store,
   * and a refusal or a lost answer is read again, so a retry adopts the first order. Named like
   * Mizan's (M-1001), no emails to the customer, stock taken whatever the store's oversell setting.
   */
  async createOrder(d: StoreOrderDraft): Promise<{ externalId: string; name: string; outcome: "created" | "already_created" }> {
    await this.ensureOrderIdDefinition();
    const read = async () => (await this.gql.run<{ order: { id: string; name: string } | null }>(Q.ORDER_BY_MIZAN_ID, { value: d.orderId }, { idempotent: true })).order;
    const found = await read();
    if (found) return { externalId: found.id, name: found.name, outcome: "already_created" };
    const money = (amount: string) => ({ shopMoney: { amount, currencyCode: d.currency } });
    const buyer = d.customer ? await this.customerFor(d.number, d.customer) : undefined;
    const a = d.address;
    const order = {
      name: d.number, currency: d.currency, sourceIdentifier: mizanOrderRef(d.orderId), tags: d.tags,
      ...(d.note ? { note: d.note } : {}), ...(d.phone ? { phone: d.phone } : {}),
      // A customer record, not a guest order, so history and messages follow the buyer.
      ...(buyer ? { customer: buyer } : {}),
      ...(d.customer?.email ? { email: d.customer.email } : {}),
      ...(d.attributes?.length ? { customAttributes: d.attributes } : {}),
      metafields: [{ ...MIZAN_ID, type: "single_line_text_field", value: d.orderId }],
      lineItems: d.lines.map((l) => (l.variantExternalId
        ? { variantId: l.variantExternalId, quantity: l.quantity, priceSet: money(l.unitPrice) }
        : { title: l.title, quantity: l.quantity, priceSet: money(l.unitPrice), requiresShipping: true, ...(l.sku ? { sku: l.sku } : {}) })),
      ...(Number(d.shipping) > 0 ? { shippingLines: [{ title: "Delivery", priceSet: money(d.shipping) }] } : {}),
      ...(Number(d.discount) > 0 ? { discountCode: { itemFixedDiscountCode: { code: "MIZAN", amountSet: money(d.discount) } } } : {}),
      shippingAddress: {
        firstName: a.firstName, ...(a.lastName ? { lastName: a.lastName } : {}), address1: a.line1, ...(a.line2 ? { address2: a.line2 } : {}), city: a.city, countryCode: a.countryCode,
        ...(a.provinceCode ? { provinceCode: a.provinceCode } : {}), ...(a.phone ? { phone: a.phone } : {}),
      },
      financialStatus: d.financialStatus,
      ...(Number(d.paid) > 0 ? { transactions: [{ kind: "SALE", status: "SUCCESS", gateway: "Mizan", amountSet: money(d.paid) }] } : {}),
    };
    const create = (input: Record<string, unknown>) => this.gql.run<{ orderCreate: { order: { id: string; name: string } | null; userErrors: UserErrors } }>(Q.ORDER_CREATE, {
      order: input, options: { sendReceipt: false, sendFulfillmentReceipt: false, inventoryBehaviour: "DECREMENT_IGNORING_POLICY" },
    }, { idempotent: false });
    try {
      let c = await create(order).catch((e: unknown) => {
        // The customer record refused (the app may not write customers on this store): the order matters more.
        if ("customer" in order && e instanceof IntegrationError && e.kind === "permission") return null;
        throw e;
      });
      const aboutCustomer = (errs: UserErrors | undefined) => Boolean(errs?.length) && errs!.every((x) => (x.field ?? []).some((f) => /customer|email/i.test(f)));
      if (c === null || ("customer" in order && aboutCustomer(c.orderCreate?.userErrors))) {
        this.drift.record({ connector: "shopify", entity: "orderCreate", kind: "missing_field", detail: `order ${d.number}: the customer record was refused; created as a guest order`, at: this.rt.clock.now() });
        const { customer: _customer, email: _email, ...guest } = order as Record<string, unknown>;
        c = await create(guest);
      }
      if (c.orderCreate?.userErrors?.length) {
        const again = await read(); // refused because it exists already (the unique id): adopt it
        if (again) return { externalId: again.id, name: again.name, outcome: "already_created" };
        assertNoUserErrors("orderCreate", c.orderCreate.userErrors);
      }
      const o = c.orderCreate?.order;
      if (!o) throw new IntegrationError({ kind: "schema_drift", connector: "shopify", message: "orderCreate returned no order" });
      return { externalId: o.id, name: o.name, outcome: "created" };
    } catch (err) {
      // No answer, a 5xx, a dropped connection: the order may exist. Read it by Mizan's id before anyone tries again.
      if (!(err instanceof IntegrationError) || !["timeout", "transient", "conflict"].includes(err.kind)) throw err;
      const again = await read();
      if (again) return { externalId: again.id, name: again.name, outcome: "already_created" };
      throw new IntegrationError({ kind: "transient", connector: "shopify", message: "orderCreate had no clear answer and no order has Mizan's id: will try again", cause: err });
    }
  }

  private orderIdDefined = false;
  /** The unique "Mizan order id" field on orders, once per store (already there is fine). */
  /**
   * The store's customer for this buyer: one it has (phone first, then email) is attached by id and
   * left untouched (toUpsert would rename it to whoever this parcel is for); none, a new one. A store
   * whose customers the app may not read: a guest order (said as drift).
   */
  private async customerFor(number: string, c: NonNullable<StoreOrderDraft["customer"]>): Promise<Record<string, unknown> | undefined> {
    if (!c.phone && !c.email) return undefined;
    const quote = (v: string) => `"${v.replace(/["\\]/g, "")}"`;
    try {
      for (const q of [c.phone ? `phone:${quote(c.phone)}` : null, c.email ? `email:${quote(c.email)}` : null]) {
        if (!q) continue;
        const r = await this.gql.run<{ customers?: unknown }>(Q.CUSTOMER_FIND, { query: q }, { idempotent: true });
        const id = new Resolver(r, { connector: "shopify", entity: "customer", drift: this.drift, now: () => this.rt.clock.now() })
          .arr<{ id?: string }>("customers", ["customers.nodes"])[0]?.id;
        if (id) return { toAssociate: { id } };
      }
    } catch (e) {
      if (!(e instanceof IntegrationError) || e.kind !== "permission") throw e;
      this.drift.record({ connector: "shopify", entity: "customer", kind: "missing_field", detail: `order ${number}: the store's customers could not be read; created as a guest order`, at: this.rt.clock.now() });
      return undefined;
    }
    return { toUpsert: {
      ...(c.firstName ? { firstName: c.firstName } : {}), ...(c.lastName ? { lastName: c.lastName } : {}),
      ...(c.phone ? { phone: c.phone } : {}), ...(c.email ? { email: c.email } : {}),
    } };
  }

  private async ensureOrderIdDefinition() {
    if (this.orderIdDefined) return;
    const r = await this.gql.run<{ metafieldDefinitionCreate: { userErrors: Array<{ field?: string[] | null; message: string; code?: string | null }> } }>(Q.ORDER_ID_DEFINITION, {
      definition: { name: "Mizan order", ...MIZAN_ID, type: "single_line_text_field", ownerType: "ORDER", capabilities: { uniqueValues: { enabled: true } }, access: { admin: "MERCHANT_READ" } },
    }, { idempotent: true });
    const errors = (r.metafieldDefinitionCreate?.userErrors ?? []).filter((e) => e.code !== "TAKEN" && !/taken|already exists|in use/i.test(e.message));
    assertNoUserErrors("metafieldDefinitionCreate", errors);
    this.orderIdDefined = true;
  }

  async createProduct(d: ProductDraft): Promise<CreatedProduct> {
    const shop = (await this.gql.run<{ shop?: { currencyCode?: string } }>(Q.SHOP_CURRENCY, {}, { idempotent: true })).shop?.currencyCode;
    if (shop && shop.toUpperCase() !== d.currency.toUpperCase()) {
      throw new IntegrationError({ kind: "validation", connector: "shopify", message: `the store sells in ${shop}; this product is priced in ${d.currency}` });
    }
    type Node = { id: string; variants: { nodes: Array<{ id: string; sku: string | null; selectedOptions: Array<{ name: string; value: string }> }> }; media: { nodes: Array<{ id: string }> } };
    const read = async () => (await this.gql.run<{ product: Node | null }>(Q.PRODUCT_BY_HANDLE, { handle: d.handle }, { idempotent: true })).product;
    let node = await read();
    let outcome: CreatedProduct["outcome"] = "already_created";
    if (!node) {
      outcome = "created";
      try {
        const c = await this.gql.run<{ productCreate: { product: Node | null; userErrors: UserErrors } }>(Q.PRODUCT_CREATE, {
          product: {
            title: d.title, handle: d.handle, status: d.status.toUpperCase(), tags: d.tags,
            ...(d.descriptionHtml ? { descriptionHtml: d.descriptionHtml } : {}), ...(d.vendor ? { vendor: d.vendor } : {}), ...(d.productType ? { productType: d.productType } : {}),
            ...(d.options.length ? { productOptions: d.options.map((o) => ({ name: o.name, values: o.values.map((name) => ({ name })) })) } : {}),
          },
          media: d.images.map((i) => ({ originalSource: i.url, mediaContentType: "IMAGE", ...(i.alt ? { alt: i.alt } : {}) })),
        }, { idempotent: false });
        assertNoUserErrors("productCreate", c.productCreate?.userErrors);
        node = c.productCreate?.product ?? null;
      } catch (err) {
        if (!(err instanceof IntegrationError) || err.kind !== "timeout") throw err;
        node = await read();
        if (!node) throw new IntegrationError({ kind: "transient", connector: "shopify", message: "productCreate timed out and no product has the handle: will try again", cause: err });
      }
      if (!node) throw new IntegrationError({ kind: "schema_drift", connector: "shopify", message: "productCreate returned no product" });
    }

    const key = (opts: ReadonlyArray<{ name: string; value: string }>) => opts.map((o) => `${o.name}=${o.value}`).join("|");
    const variants: Record<string, string> = {};
    const input = (v: ProductDraft["variants"][number]) => ({
      price: v.price, ...(v.compareAtPrice ? { compareAtPrice: v.compareAtPrice } : {}), ...(v.barcode ? { barcode: v.barcode } : {}), inventoryItem: { sku: v.sku },
    });
    let have = node.variants.nodes;
    if (!d.options.length) {
      // One variant, made with the product: its price, SKU and barcode (an update, safe to repeat).
      const v = have[0];
      if (!v) throw new IntegrationError({ kind: "schema_drift", connector: "shopify", message: "the product has no variant" });
      const u = await this.gql.run<{ productVariantsBulkUpdate: { userErrors: UserErrors } }>(Q.VARIANTS_UPDATE, { productId: node.id, variants: [{ id: v.id, ...input(d.variants[0]!) }] }, { idempotent: true });
      assertNoUserErrors("productVariantsBulkUpdate", u.productVariantsBulkUpdate?.userErrors);
      variants[d.variants[0]!.variantId] = v.id;
    } else {
      // Only the variant Shopify made with the product (no SKU yet): replace it with all of them.
      const fresh = have.length <= 1 && !have[0]?.sku;
      const byKey = new Map(have.map((v) => [key(v.selectedOptions), v.id]));
      const missing = fresh ? d.variants : d.variants.filter((v) => !byKey.has(key(v.options)));
      if (missing.length) {
        try {
          const c = await this.gql.run<{ productVariantsBulkCreate: { productVariants: Node["variants"]["nodes"] | null; userErrors: UserErrors } }>(Q.VARIANTS_CREATE, {
            productId: node.id, strategy: fresh ? "REMOVE_STANDALONE_VARIANT" : "DEFAULT",
            variants: missing.map((v) => ({ ...input(v), optionValues: v.options.map((o) => ({ optionName: o.name, name: o.value })) })),
          }, { idempotent: false });
          assertNoUserErrors("productVariantsBulkCreate", c.productVariantsBulkCreate?.userErrors);
          have = fresh ? (c.productVariantsBulkCreate?.productVariants ?? []) : [...have, ...(c.productVariantsBulkCreate?.productVariants ?? [])];
        } catch (err) {
          if (!(err instanceof IntegrationError) || err.kind !== "timeout") throw err;
          // Made or not, the retry reads the product again and adds only what is still missing.
          throw new IntegrationError({ kind: "transient", connector: "shopify", message: "productVariantsBulkCreate timed out: will read the product and add what is missing", cause: err });
        }
      }
      const ids = new Map(have.map((v) => [key(v.selectedOptions), v.id]));
      for (const v of d.variants) {
        const id = ids.get(key(v.options));
        if (!id) throw new IntegrationError({ kind: "schema_drift", connector: "shopify", message: `no variant for ${key(v.options)} after creating them` });
        variants[v.variantId] = id;
      }
    }
    // Pictures in the order they were sent.
    const images: Record<string, string> = {};
    for (const [i, m] of node.media.nodes.entries()) if (d.images[i]) images[d.images[i]!.imageId] = m.id;
    const onlineStore = d.status === "active" ? await this.publishOnlineStore(node.id) : false;
    return { outcome, externalId: node.id, variants, images, onlineStore };
  }

  /**
   * Put a product on the shop's Online Store (P3): Shopify adds a new product to no sales channel.
   * Safe to repeat. A store that has not approved read/write_publications yet (or has no Online
   * Store) is not an error: the product is made, and the merchant picks its channels in Shopify.
   */
  async publishOnlineStore(productId: string): Promise<boolean> {
    try {
      const list = await this.gql.run<{ publications?: { nodes?: Array<{ id: string; name?: string | null; catalog?: { title?: string | null } | null }> } }>(Q.PUBLICATIONS, {}, { idempotent: true });
      const online = (list.publications?.nodes ?? []).find((p) => /^online store$/i.test((p.catalog?.title ?? p.name ?? "").trim()));
      if (!online) return false;
      const d = await this.gql.run<{ publishablePublish: { userErrors: UserErrors } }>(Q.PUBLISHABLE_PUBLISH, { id: productId, input: [{ publicationId: online.id }] }, { idempotent: true });
      assertNoUserErrors("publishablePublish", d.publishablePublish?.userErrors);
      return true;
    } catch (e) {
      if (e instanceof IntegrationError && e.kind === "permission") return false;
      throw e;
    }
  }

  /**
   * Change an order before it ships (O3): the address with orderUpdate (sending the same address
   * twice changes nothing), quantities, new items and the delivery fee in one order edit. Safe to
   * repeat: an applied edit leaves its marker tag (put on last), and an order that already has the
   * edit's quantities and fee is not edited again; the commit is not idempotent, so a timeout is
   * checked by reading the order, never re-sent blindly. Prices are not changed here: Shopify keeps
   * a line's original price in an edit (only a discount lowers it), so a price change is refused
   * (`validation`) and made in Shopify. A cancelled order cannot be edited (`validation`).
   */
  async editOrder(plan: OrderEditPlan): Promise<"applied" | "already_applied"> {
    const tag = editMarker(plan.editId);
    const num = (gid: string | undefined) => gid?.split("/").pop();
    const read = async () => {
      const raw = await this.gql.run<{ order: Record<string, unknown> | null }>(Q.ORDER_BY_ID, { id: plan.orderId }, { idempotent: true });
      if (!raw.order) throw new IntegrationError({ kind: "not_found", connector: "shopify", message: `order ${plan.orderId} not found` });
      const r = new Resolver(raw.order, { connector: "shopify", entity: "order", drift: this.drift, now: () => this.rt.clock.now() });
      const lines = r.arr("lineItems", ["lineItems"]).map((li) => {
        const lr = r.child(li, "order.lineItem");
        return { id: lr.str("id", ["id"]), variantId: lr.str("variantId", ["variant.id", "variantId"]), quantity: lr.num("quantity", ["currentQuantity", "quantity"]) ?? 0 };
      });
      return {
        lines, tagged: r.arr<string>("tags", ["tags"]).includes(tag), cancelled: Boolean(r.str("cancelledAt", ["cancelledAt"])),
        shipping: Number(r.str("shipping", ["totalShippingPriceSet.shopMoney.amount", "totalShippingPrice"]) ?? "0"),
      };
    };
    type State = Awaited<ReturnType<typeof read>>;
    const lineOf = (st: State, id: string) => st.lines.find((l) => num(l.id) === num(id));
    // What the order looks like once the edit is in.
    const done = (st: State) =>
      plan.lines.every((l) => (lineOf(st, l.lineId)?.quantity ?? 0) === l.quantity)
      && plan.add.every((a) => st.lines.some((l) => l.variantId === a.variantId && l.quantity >= a.quantity))
      && (plan.shipping === undefined || Math.abs(st.shipping - Number(plan.shipping)) < 0.005);

    const before = await read();
    if (before.tagged) return "already_applied";
    if (before.cancelled) throw new IntegrationError({ kind: "validation", connector: "shopify", message: `order ${plan.orderId} is cancelled` });
    if ([...plan.lines, ...plan.add].some((l) => l.unitPrice !== undefined)) {
      throw new IntegrationError({ kind: "validation", connector: "shopify", message: "Shopify keeps an item's price when an order is edited: change the price in Shopify" });
    }

    if (plan.address) {
      const a = plan.address;
      const [firstName, ...rest] = (a.name ?? "").trim().split(/\s+/);
      // MailingAddressInput takes the code, not the name ("C", never "Cairo" or a code in a name field).
      const provinceCode = a.provinceCode ?? (a.province ? findRegion(a.countryCode ?? "EG", a.province)?.code : undefined);
      const d = await this.gql.run<{ orderUpdate: { userErrors: UserErrors } }>(Q.ORDER_UPDATE, { input: { id: plan.orderId, shippingAddress: {
        address1: a.line1, address2: a.line2 ?? null, city: a.city, ...(provinceCode ? { provinceCode } : {}),
        ...(a.countryCode ? { countryCode: a.countryCode } : {}), ...(a.phone ? { phone: a.phone } : {}),
        ...(firstName ? { firstName, lastName: rest.join(" ") || null } : {}),
      } } }, { idempotent: true });
      assertNoUserErrors("orderUpdate", d.orderUpdate?.userErrors);
    }

    if (!done(before)) {
      const begin = await this.gql.run<{ orderEditBegin: { calculatedOrder?: Record<string, unknown> | null; userErrors: UserErrors } }>(Q.ORDER_EDIT_BEGIN, { id: plan.orderId }, { idempotent: true });
      assertNoUserErrors("orderEditBegin", begin.orderEditBegin?.userErrors);
      const co = begin.orderEditBegin?.calculatedOrder;
      const calcId = co && typeof co.id === "string" ? co.id : null;
      if (!co || !calcId) throw new IntegrationError({ kind: "schema_drift", connector: "shopify", message: "orderEditBegin: no calculatedOrder.id" });
      const cr = new Resolver(co, { connector: "shopify", entity: "calculatedOrder", drift: this.drift, now: () => this.rt.clock.now() });
      const calcLines = cr.arr("lineItems", ["lineItems"]).map((li) => {
        const lr = cr.child(li, "calculatedOrder.lineItem");
        return { id: lr.str("id", ["id"]), variantId: lr.str("variantId", ["variant.id", "variantId"]) };
      });
      const calcShipping = cr.arr("shippingLines", ["shippingLines"]).map((x) => {
        const xr = cr.child(x, "calculatedOrder.shippingLine");
        return { id: xr.str("id", ["id"]), title: xr.str("title", ["title"]) };
      });
      // Edits stay staged until the commit: each step is safe to repeat.
      const step = async (op: Q.GqlOperation, field: string, vars: Record<string, unknown>) => {
        const d = await this.gql.run<Record<string, { userErrors: UserErrors } | undefined>>(op, { id: calcId, ...vars }, { idempotent: true });
        assertNoUserErrors(field, d[field]?.userErrors);
      };
      for (const l of plan.lines) {
        if ((lineOf(before, l.lineId)?.quantity ?? 0) === l.quantity) continue;
        // A calculated line carries its order line's number; else the same variant (confirm on a dev store).
        const calc = calcLines.find((c) => num(c.id) === num(l.lineId)) ?? (l.variantId ? calcLines.find((c) => c.variantId === l.variantId) : undefined);
        if (!calc?.id) throw new IntegrationError({ kind: "schema_drift", connector: "shopify", message: `orderEditBegin: no calculated line for ${l.lineId}` });
        await step(Q.ORDER_EDIT_SET_QUANTITY, "orderEditSetQuantity", { lineItemId: calc.id, quantity: l.quantity });
      }
      for (const a of plan.add) {
        if (before.lines.some((l) => l.variantId === a.variantId && l.quantity >= a.quantity)) continue;
        await step(Q.ORDER_EDIT_ADD_VARIANT, "orderEditAddVariant", { variantId: a.variantId, quantity: a.quantity });
      }
      if (plan.shipping !== undefined && Math.abs(before.shipping - Number(plan.shipping)) >= 0.005) {
        for (const x of calcShipping) if (x.id) await step(Q.ORDER_EDIT_REMOVE_SHIPPING, "orderEditRemoveShippingLine", { shippingLineId: x.id });
        if (Number(plan.shipping) > 0) {
          await step(Q.ORDER_EDIT_ADD_SHIPPING, "orderEditAddShippingLine", {
            shippingLine: { title: calcShipping[0]?.title ?? "Shipping", price: { amount: plan.shipping, currencyCode: plan.currency } },
          });
        }
      }
      try {
        const c = await this.gql.run<{ orderEditCommit: { userErrors: UserErrors } }>(Q.ORDER_EDIT_COMMIT, { id: calcId, notifyCustomer: false, staffNote: "Mizan: order edited before shipping" }, { idempotent: false });
        assertNoUserErrors("orderEditCommit", c.orderEditCommit?.userErrors);
      } catch (err) {
        if (!(err instanceof IntegrationError) || err.kind !== "timeout") throw err;
        if (!done(await read())) throw new IntegrationError({ kind: "transient", connector: "shopify", message: "orderEditCommit timed out and the order does not have the edit: will start it again", cause: err });
      }
    }
    await this.addTags(plan.orderId, [tag]);
    return "applied";
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

  /** A tag the team took off in Mizan (O2); removing one the order no longer has is a no-op. */
  async removeTags(id: string, tags: string[]): Promise<void> {
    const d = await this.gql.run<{ tagsRemove: { userErrors: UserErrors } }>(Q.TAGS_REMOVE, { id, tags }, { idempotent: true });
    assertNoUserErrors("tagsRemove", d.tagsRemove?.userErrors);
  }

  // ───────────── webhooks ─────────────

  /**
   * Make this app's subscriptions on the shop exactly `topics` → `uri`: delete ours that point
   * elsewhere (old URL, old connection) or at topics we no longer want, create the missing ones.
   * Safe to repeat: Shopify refuses a second subscription for the same topic and address.
   * Compliance topics (customers/redact …) are app configuration, not subscriptions.
   */
  /**
   * Converge the store's subscriptions on `topics` at `uri`. A topic Shopify refuses because the app's
   * protected customer data is not approved yet (orders, customers) is skipped and returned in `refused`:
   * the other topics (app/uninstalled above all) still register, and a later sync adds it once approved.
   */
  async syncWebhooks(uri: string, topics: readonly string[]): Promise<{ created: string[]; deleted: number; kept: number; refused: string[] }> {
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
    const refused: string[] = [];
    for (const topic of topics.filter((t) => !existing.some((x) => x.topic === t && x.uri === uri))) {
      const res = await this.gql.run<{ webhookSubscriptionCreate: { userErrors: UserErrors } }>(Q.WEBHOOK_CREATE, { topic, sub: { uri, format: "JSON" } }, { idempotent: true });
      const errs = (res.webhookSubscriptionCreate?.userErrors ?? []).filter((x) => !/already been taken|already exists/i.test(x.message));
      if (errs.length && errs.every((x) => PROTECTED_DATA.test(x.message))) {
        refused.push(topic);
        continue;
      }
      assertNoUserErrors("webhookSubscriptionCreate", errs);
      created.push(topic);
    }
    return { created, deleted, kept: existing.length - deleted, refused };
  }

  health() {
    return { circuit: this.gql.circuit.status, budget: this.gql.bucket.snapshot };
  }
}

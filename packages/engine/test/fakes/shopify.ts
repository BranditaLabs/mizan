import { randomBytes } from "node:crypto";
import { signShopifyQuery } from "../../src/connectors/shopify/oauth.js";
import { signShopify } from "../../src/connectors/shopify/webhooks.js";
import { hang, json, type FakeClock } from "./clock.js";

/**
 * In-memory Shopify Admin GraphQL. Routes by operationName, keeps real
 * state (orders, products, inventory, fulfillments) and can misbehave:
 * cost-based throttling, 5xx, hangs, served-version fall-forward, rejected
 * fields (as after an API version change) and dropped fields.
 */

/** lost: the call is carried out, then the response never arrives (a commit that "timed out"). */
type Fault = "500" | "timeout" | "network" | "throttle" | "lost";

interface Variant { id: string; sku: string; barcode?: string | null; title: string; price: string; compareAtPrice: string | null; inventoryItemId: string }
interface Product { id: string; title: string; status: string; vendor: string; productType: string; tags: string[]; descriptionHtml: string; updatedAt: string; variants: Variant[] }
interface Order {
  id: string; name: string; createdAt: string; updatedAt: string; cancelledAt: string | null; displayFinancialStatus: string;
  paymentGatewayNames: string[]; tags: string[]; currencyCode: string; email: string | null; phone: string | null;
  total: string; received: string; refunded: string; shippingAddress: Record<string, unknown> | null; customer: Record<string, unknown>;
  lines: Array<{ id: string; title: string; sku: string; quantity: number; price: string }>;
  fulfillmentOrders: Array<{ id: string; status: string }>;
  fulfillments: Array<{ id: string; status: string; trackingInfo: Array<{ company: string; number: string; url?: string }>; events?: Array<{ id: string; status: string; happenedAt: string; message?: string }> }>;
  /** Where the order came from (M7-2), as Shopify reports it. */
  source?: OrderSource;
}

type Visit = { landingPage?: string | null; referrerUrl?: string | null; source?: string; sourceType?: string | null; occurredAt?: string; utmParameters?: { source?: string; medium?: string; campaign?: string; content?: string; term?: string } | null };
export interface OrderSource {
  journey?: { ready: boolean; firstVisit?: Visit | null; lastVisit?: Visit | null } | null;
  discountCodes?: string[];
  customAttributes?: Array<{ key: string; value: string }>;
  sourceName?: string;
}

export class FakeShopify {
  readonly clientId = "fake-client-id";
  readonly secret = "shpss_test_secret";
  /** OAuth codes issued by authorize(); each works once (Shopify: "already used"). */
  private codes = new Map<string, { scopes: string[]; used: boolean }>();
  /** Access tokens issued by the OAuth exchange. */
  readonly tokens: string[] = [];
  /** Tokens revoked by uninstall(); requests with them get Shopify's 401. */
  readonly revoked = new Set<string>();
  /** This app's webhook subscriptions on the shop. */
  webhooks = new Map<string, { topic: string; uri: string }>();
  products = new Map<string, Product>();
  /** Open order edits (orderEditBegin) and how many were committed. */
  readonly edits = new Map<string, { orderId: string; adds: Array<{ lineId: string; variantId: string; qty: number; pct: number }> }>();
  committedEdits = 0;
  /** orderCancel mutations that cancelled an order (a second one is refused by the store). */
  cancels = 0;
  orders = new Map<string, Order>();
  inventory = new Map<string, number>();
  calls: Array<{ op: string; variables: Record<string, unknown> }> = [];
  faults: Array<{ op?: string; fault: Fault }> = [];
  randomFaultRate = 0;
  servedVersion = "2026-10";
  bucket = { max: 1000, available: 1000, restore: 100, last: 0 };
  costPerCall = 10;
  rejectFields = new Set<string>();
  /** Fields this app may not read (a missing scope or protected data level): Shopify nulls them and answers ACCESS_DENIED. */
  denyFields = new Set<string>();
  dropPaths = new Set<string>();
  /** FulfillmentEventStatus values this API version accepts (an older one lacks CARRIER_PICKED_UP). */
  eventStatuses = new Set(["CONFIRMED", "LABEL_PRINTED", "CARRIER_PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY", "ATTEMPTED_DELIVERY", "DELIVERED", "FAILURE", "DELAYED", "READY_FOR_PICKUP"]);
  /** Simulate someone changing stock between our read and our write. */
  concurrentStockChanges = 0;
  private idempotency = new Map<string, unknown>();
  private seq = 1000;

  constructor(private readonly clock: FakeClock, private readonly random: () => number = Math.random, readonly host = "fake-store.myshopify.com") {
    this.bucket.last = clock.now();
  }

  private nextId(type: string) {
    return `gid://shopify/${type}/${++this.seq}`;
  }

  private touch() {
    return new Date(this.clock.now()).toISOString();
  }

  addProduct(p: { title: string; price: string; sku?: string; barcode?: string; stock?: number; location?: string }) {
    const id = this.nextId("Product");
    const vid = this.nextId("ProductVariant");
    const itemId = this.nextId("InventoryItem");
    this.products.set(id, {
      id, title: p.title, status: "ACTIVE", vendor: "Serum Beauty", productType: "Skincare", tags: [], descriptionHtml: "", updatedAt: this.touch(),
      variants: [{ id: vid, sku: p.sku ?? "SKU", barcode: p.barcode ?? null, title: "Default", price: p.price, compareAtPrice: null, inventoryItemId: itemId }],
    });
    this.inventory.set(`${itemId}|${p.location ?? "gid://shopify/Location/1"}`, p.stock ?? 10);
    return { productId: id, variantId: vid, inventoryItemId: itemId };
  }

  /**
   * payment: how the customer pays. "cod" (default), "card" (paid via Paymob), "deposit" (300 paid online,
   * balance COD), "bnpl" (Tabby), "bank" (bank transfer, unpaid until paid()), "manual" (unrecognised method).
   * `cod: false` is kept as a shorthand for "card".
   */
  addOrder(o: Partial<{ city: string; province: string; phone: string; cod: boolean; payment: "cod" | "card" | "deposit" | "bnpl" | "bank" | "manual"; tags: string[]; total: string; name: string; createdAt: string; source: OrderSource }> = {}) {
    const id = this.nextId("Order");
    const now = this.touch();
    const payment = o.payment ?? (o.cod === false ? "card" : "cod");
    const total = o.total ?? "1150.00";
    const P: Record<string, { status: string; gateways: string[]; received: string }> = {
      cod: { status: "PENDING", gateways: ["Cash on Delivery (COD)"], received: "0.00" },
      card: { status: "PAID", gateways: ["paymob"], received: total },
      deposit: { status: "PARTIALLY_PAID", gateways: ["paymob", "Cash on Delivery (COD)"], received: "300.00" },
      bnpl: { status: "PAID", gateways: ["Tabby"], received: total },
      bank: { status: "PENDING", gateways: ["Bank Deposit"], received: "0.00" },
      manual: { status: "PENDING", gateways: ["manual"], received: "0.00" },
    };
    const pay = P[payment];
    const order: Order = {
      id, name: o.name ?? `#${1000 + this.orders.size + 1}`, createdAt: o.createdAt ?? now, updatedAt: o.createdAt && o.createdAt > now ? o.createdAt : now, cancelledAt: null,
      displayFinancialStatus: pay.status,
      paymentGatewayNames: pay.gateways, received: pay.received, refunded: "0.00",
      tags: o.tags ?? [], currencyCode: "EGP", email: "mona@example.com", phone: null, total,
      shippingAddress: {
        name: "Mona Adel", firstName: "Mona", lastName: "Adel", phone: o.phone ?? "+20 100 123 4821",
        address1: "12 Abbas El Akkad St", address2: "Floor 3", city: o.city ?? "Nasr City", province: o.province ?? "Cairo", zip: "11765", countryCodeV2: "EG",
      },
      customer: { displayName: "Mona Adel", firstName: "Mona", lastName: "Adel", defaultEmailAddress: { emailAddress: "mona@example.com" }, defaultPhoneNumber: { phoneNumber: "+201001234821" }, email: "mona@example.com", phone: "+201001234821" },
      lines: [{ id: this.nextId("LineItem"), title: "Vitamin C serum 30 ml", sku: "SER-30", quantity: 2, price: "575.00" }],
      fulfillmentOrders: [{ id: this.nextId("FulfillmentOrder"), status: "OPEN" }],
      fulfillments: [],
      ...(o.source ? { source: o.source } : {}),
    };
    this.orders.set(id, order);
    return order;
  }

  /** The customer completes payment (e.g. the bank transfer arrives and the merchant marks it). */
  paid(orderId: string) {
    const o = this.orders.get(orderId)!;
    o.received = o.total;
    o.displayFinancialStatus = "PAID";
    o.updatedAt = this.touch();
  }

  /** The merchant refunds part or all of the order in Shopify admin. */
  refund(orderId: string, amount: string) {
    const o = this.orders.get(orderId)!;
    o.refunded = (Number(o.refunded) + Number(amount)).toFixed(2);
    o.displayFinancialStatus = Number(o.refunded) >= Number(o.received) ? "REFUNDED" : "PARTIALLY_REFUNDED";
    o.updatedAt = this.touch();
  }

  /** A merchant edits a price directly in Shopify admin. */
  adminSetPrice(productId: string, variantId: string, price: string) {
    const p = this.products.get(productId)!;
    p.variants.find((v) => v.id === variantId)!.price = price;
    p.updatedAt = this.touch();
  }

  webhook(topic: string, resource: { id: string; updatedAt?: string }, eventId = `evt-${++this.seq}`) {
    const numeric = resource.id.split("/").pop();
    const body = JSON.stringify({ id: Number(numeric), admin_graphql_api_id: resource.id, updated_at: resource.updatedAt ?? this.touch() });
    return {
      body,
      headers: {
        "X-Shopify-Topic": topic, "X-Shopify-Shop-Domain": this.host, "X-Shopify-Event-Id": eventId,
        "X-Shopify-Webhook-Id": `wh-${this.seq}`, "X-Shopify-API-Version": this.servedVersion, "X-Shopify-Hmac-SHA256": signShopify(body, this.secret),
      } as Record<string, string>,
    };
  }

  private refill() {
    const now = this.clock.now();
    this.bucket.available = Math.min(this.bucket.max, this.bucket.available + ((now - this.bucket.last) / 1000) * this.bucket.restore);
    this.bucket.last = now;
  }

  private cost(extra: Record<string, unknown> = {}) {
    return { cost: { requestedQueryCost: this.costPerCall, actualQueryCost: this.costPerCall, throttleStatus: { maximumAvailable: this.bucket.max, currentlyAvailable: Math.floor(this.bucket.available), restoreRate: this.bucket.restore } }, ...extra };
  }

  /**
   * The merchant approves the app on Shopify's authorize page: returns the signed callback
   * query Shopify redirects the browser to. Like Shopify, the granted `scope` omits
   * `read_x` when `write_x` is granted (write implies read).
   */
  authorize(state: string, scopes: string[], at = this.clock.now()): Record<string, string> {
    const code = randomBytes(16).toString("hex");
    this.codes.set(code, { scopes, used: false });
    const q: Record<string, string> = { code, host: Buffer.from(`admin.shopify.com/store/${this.host.split(".")[0]}`).toString("base64url"), shop: this.host, state, timestamp: String(Math.floor(at / 1000)) };
    return { ...q, hmac: signShopifyQuery(q, this.secret) };
  }

  /**
   * The merchant uninstalls the app: Shopify revokes the app's tokens, drops its webhook
   * subscriptions, and sends app/uninstalled. Returns that webhook.
   */
  uninstall() {
    for (const t of this.tokens) this.revoked.add(t);
    this.revoked.add("shpat_test");
    this.webhooks.clear();
    const body = JSON.stringify({ id: 954889, name: "Fake Store", domain: this.host, myshopify_domain: this.host });
    return {
      body,
      headers: {
        "X-Shopify-Topic": "app/uninstalled", "X-Shopify-Shop-Domain": this.host, "X-Shopify-Event-Id": `evt-${++this.seq}`,
        "X-Shopify-Webhook-Id": `wh-${this.seq}`, "X-Shopify-API-Version": this.servedVersion, "X-Shopify-Hmac-SHA256": signShopify(body, this.secret),
      } as Record<string, string>,
    };
  }

  /** A compliance webhook as Shopify sends it to the app's single compliance URL. */
  complianceWebhook(topic: "customers/data_request" | "customers/redact" | "shop/redact", payload: Record<string, unknown>, eventId = `evt-${++this.seq}`) {
    const body = JSON.stringify({ shop_id: 954889, shop_domain: this.host, ...payload });
    return {
      body,
      headers: {
        "X-Shopify-Topic": topic, "X-Shopify-Shop-Domain": this.host, "X-Shopify-Event-Id": eventId, "X-Shopify-Webhook-Id": `wh-${this.seq}`,
        "X-Shopify-API-Version": this.servedVersion, "X-Shopify-Hmac-SHA256": signShopify(body, this.secret),
      } as Record<string, string>,
    };
  }

  /** An App Store launch / install link to the app URL, signed by Shopify. */
  launch(at = this.clock.now()): Record<string, string> {
    const q: Record<string, string> = { shop: this.host, timestamp: String(Math.floor(at / 1000)) };
    return { ...q, hmac: signShopifyQuery(q, this.secret) };
  }

  private oauth(init: RequestInit): Response | Promise<Response> {
    const fi = this.faults.findIndex((f) => f.op === "oauthAccessToken");
    const fault = fi >= 0 ? this.faults.splice(fi, 1)[0]!.fault : undefined;
    if (fault === "500") return json(502, { errors: "Bad gateway" });
    if (fault === "timeout") return hang(init);
    if (fault === "network") throw new TypeError("fetch failed: ECONNRESET");
    const body = JSON.parse(String(init.body)) as { client_id?: string; client_secret?: string; code?: string };
    if (body.client_id !== this.clientId || body.client_secret !== this.secret) {
      return json(400, { error: "invalid_client", error_description: "Client credentials are invalid" });
    }
    const grant = body.code ? this.codes.get(body.code) : undefined;
    if (!grant || grant.used) {
      return json(400, { error: "invalid_request", error_description: "The authorization code was not found or was already used" });
    }
    grant.used = true;
    const token = `shpat_${randomBytes(16).toString("hex")}`;
    this.tokens.push(token);
    const granted = grant.scopes.filter((s) => !(s.startsWith("read_") && grant.scopes.includes(`write_${s.slice(5)}`)));
    return json(200, { access_token: token, scope: granted.join(",") });
  }

  handler = async (url: URL, init: RequestInit): Promise<Response> => {
    if (url.pathname === "/admin/oauth/access_token") return this.oauth(init);
    const token = new Headers(init.headers).get("X-Shopify-Access-Token");
    if (token && this.revoked.has(token)) return json(401, { errors: "[API] Invalid API key or access token (unrecognized login or wrong password)" });
    const { query, variables, operationName } = JSON.parse(String(init.body)) as { query: string; variables: Record<string, unknown>; operationName: string };
    const op = operationName;
    const headers = { "X-Shopify-API-Version": this.servedVersion };

    const fi = this.faults.findIndex((f) => !f.op || f.op === op);
    let fault: Fault | undefined = fi >= 0 ? this.faults.splice(fi, 1)[0].fault : undefined;
    if (!fault && this.randomFaultRate && this.random() < this.randomFaultRate) fault = (["500", "timeout", "throttle", "network"] as Fault[])[Math.floor(this.random() * 4)];
    if (fault === "500") return json(502, { errors: "Bad gateway" }, headers);
    if (fault === "timeout") return hang(init);
    if (fault === "network") throw new TypeError("fetch failed: ECONNRESET");

    this.refill();
    if (fault === "throttle" || this.bucket.available < this.costPerCall) {
      return json(200, { errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }], extensions: this.cost() }, headers);
    }
    for (const f of this.rejectFields) {
      if (query.includes(f)) return json(200, { errors: [{ message: `Field '${f}' doesn't exist on type 'Customer'`, extensions: { code: "undefinedField" } }] }, headers);
    }
    this.bucket.available -= this.costPerCall;
    this.calls.push({ op, variables });
    let data: unknown;
    try {
      data = this.execute(op, variables);
    } catch (err) {
      const errors = (err as { graphqlErrors?: unknown[] }).graphqlErrors;
      if (errors) return json(200, { errors, extensions: this.cost() }, headers);
      throw err;
    }
    if (fault === "lost") return hang(init);
    // Like GraphQL, only what was asked for: a query without the source fields gets none.
    const unasked = new Set(["customerJourneySummary", "discountCodes", "customAttributes", "sourceName"].filter((f) => !query.includes(f)));
    if (unasked.size) data = this.nullFields(data, unasked, true);
    const denied = [...this.denyFields].filter((f) => query.includes(f));
    if (denied.length) {
      const errors = denied.map((f) => ({ message: `Access denied for ${f} field.`, path: [op === "MizanOrders" ? "orders" : "order", f], extensions: { code: "ACCESS_DENIED" } }));
      return json(200, { data: this.drop(this.nullFields(data, new Set(denied))), errors, extensions: this.cost() }, headers);
    }
    return json(200, { data: this.drop(data), extensions: this.cost() }, headers);
  };

  private nullFields(data: unknown, fields: Set<string>, remove = false): unknown {
    const clone = structuredClone(data);
    const walk = (o: unknown) => {
      if (Array.isArray(o)) return o.forEach(walk);
      if (!o || typeof o !== "object") return;
      for (const k of Object.keys(o as Record<string, unknown>)) {
        if (fields.has(k) && remove) delete (o as Record<string, unknown>)[k];
        else if (fields.has(k)) (o as Record<string, unknown>)[k] = null;
        else walk((o as Record<string, unknown>)[k]);
      }
    };
    walk(clone);
    return clone;
  }

  private drop(data: unknown) {
    if (!this.dropPaths.size) return data;
    const clone = structuredClone(data);
    const walk = (o: unknown, path: string) => {
      if (Array.isArray(o)) return o.forEach((x) => walk(x, path));
      if (!o || typeof o !== "object") return;
      for (const k of Object.keys(o as Record<string, unknown>)) {
        const p = path ? `${path}.${k}` : k;
        if ([...this.dropPaths].some((d) => p.endsWith(d))) delete (o as Record<string, unknown>)[k];
        else walk((o as Record<string, unknown>)[k], p);
      }
    };
    walk(clone, "");
    return clone;
  }

  /** Like Shopify: a line points at its variant while the product exists, else null. */
  private variantBySku(sku: string) {
    for (const p of this.products.values()) for (const v of p.variants) if (v.sku === sku) return { id: v.id };
    return null;
  }

  private gqlOrder(o: Order) {
    const m = (a: string) => ({ shopMoney: { amount: a, currencyCode: "EGP" } });
    return {
      id: o.id, name: o.name, createdAt: o.createdAt, updatedAt: o.updatedAt, cancelledAt: o.cancelledAt, displayFinancialStatus: o.displayFinancialStatus,
      paymentGatewayNames: o.paymentGatewayNames, tags: o.tags, currencyCode: o.currencyCode, email: o.email, phone: o.phone,
      totalPriceSet: m(o.total), subtotalPriceSet: m(o.total), totalShippingPriceSet: m("0.00"),
      totalReceivedSet: m(o.received), totalRefundedSet: m(o.refunded),
      totalOutstandingSet: m(Math.max(0, Number(o.total) - Number(o.received)).toFixed(2)),
      shippingAddress: o.shippingAddress, customer: o.customer,
      lineItems: { nodes: o.lines.map((l) => ({ id: l.id, title: l.title, sku: l.sku, quantity: l.quantity, variant: this.variantBySku(l.sku), originalUnitPriceSet: m(l.price) })) },
      fulfillmentOrders: { nodes: o.fulfillmentOrders.map((f) => ({ id: f.id, status: f.status, lineItems: { nodes: o.lines.map((l) => ({ id: `${f.id}-${l.id}`, lineItem: { id: l.id } })) } })) },
      fulfillments: o.fulfillments,
      sourceName: o.source?.sourceName ?? "web", discountCodes: o.source?.discountCodes ?? [], customAttributes: o.source?.customAttributes ?? [],
      customerJourneySummary: o.source?.journey ?? { ready: false, firstVisit: null, lastVisit: null },
    };
  }

  private gqlProduct(p: Product) {
    return {
      id: p.id, title: p.title, status: p.status, vendor: p.vendor, productType: p.productType, tags: p.tags, descriptionHtml: p.descriptionHtml, updatedAt: p.updatedAt,
      variants: { nodes: p.variants.map((v) => ({ id: v.id, sku: v.sku, barcode: v.barcode ?? null, title: v.title, price: v.price, compareAtPrice: v.compareAtPrice, inventoryQuantity: [...this.inventory.entries()].filter(([k]) => k.startsWith(v.inventoryItemId)).reduce((n, [, q]) => n + q, 0), inventoryItem: { id: v.inventoryItemId, inventoryLevels: { nodes: [...this.inventory.keys()].filter((k) => k.startsWith(`${v.inventoryItemId}|`)).map((k) => ({ location: { id: k.split("|")[1] } })) } } })) },
    };
  }

  private execute(op: string, v: Record<string, any>): unknown {
    switch (op) {
      case "MizanOrder": {
        const o = this.orders.get(v.id);
        return { order: o ? this.gqlOrder(o) : null };
      }
      case "MizanOrders": {
        const since = String(v.query ?? "").match(/updated_at:>='([^']+)'/)?.[1];
        const created = String(v.query ?? "").match(/created_at:>='([^']+)'/)?.[1];
        const before = String(v.query ?? "").match(/created_at:<'([^']+)'/)?.[1];
        const all = [...this.orders.values()].filter((o) => (!since || o.updatedAt >= since) && (!created || o.createdAt >= created) && (!before || o.createdAt < before))
          .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
        const start = v.after ? Number(v.after) : 0;
        const page = all.slice(start, start + v.first);
        const next = start + v.first < all.length;
        return { orders: { pageInfo: { hasNextPage: next, endCursor: next ? String(start + v.first) : null }, nodes: page.map((o) => this.gqlOrder(o)) } };
      }
      case "MizanProducts": {
        const since = String(v.query ?? "").match(/updated_at:>='([^']+)'/)?.[1];
        const all = [...this.products.values()].filter((p) => !since || p.updatedAt >= since).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
        const start = v.after ? Number(v.after) : 0;
        const next = start + v.first < all.length;
        return { products: { pageInfo: { hasNextPage: next, endCursor: next ? String(start + v.first) : null }, nodes: all.slice(start, start + v.first).map((p) => this.gqlProduct(p)) } };
      }
      case "MizanProduct": {
        const p = this.products.get(v.id);
        return { product: p ? this.gqlProduct(p) : null };
      }
      case "MizanInventoryLevel": {
        const q = this.inventory.get(`${v.id}|${v.locationId}`);
        return { inventoryItem: { id: v.id, inventoryLevel: q === undefined ? null : { quantities: [{ name: "available", quantity: q }] } } };
      }
      case "MizanProductUpdate": {
        const p = this.products.get(v.product.id);
        if (!p) return { productUpdate: { product: null, userErrors: [{ field: ["id"], message: "Product does not exist" }] } };
        Object.assign(p, { ...v.product, id: p.id, status: v.product.status ?? p.status, updatedAt: this.touch() });
        return { productUpdate: { product: { id: p.id, updatedAt: p.updatedAt }, userErrors: [] } };
      }
      case "MizanVariantsUpdate": {
        const p = this.products.get(v.productId);
        if (!p) return { productVariantsBulkUpdate: { productVariants: null, userErrors: [{ field: ["productId"], message: "Product does not exist" }] } };
        for (const upd of v.variants) {
          const variant = p.variants.find((x) => x.id === upd.id);
          if (!variant) return { productVariantsBulkUpdate: { productVariants: null, userErrors: [{ field: ["variants", "id"], message: "Variant does not exist" }] } };
          if (upd.price !== undefined) variant.price = String(upd.price);
          if (upd.compareAtPrice !== undefined) variant.compareAtPrice = upd.compareAtPrice;
        }
        p.updatedAt = this.touch();
        return { productVariantsBulkUpdate: { productVariants: p.variants.map((x) => ({ id: x.id, price: x.price, compareAtPrice: x.compareAtPrice })), userErrors: [] } };
      }
      case "MizanInventorySet": {
        if (this.idempotency.has(v.idempotencyKey)) return this.idempotency.get(v.idempotencyKey);
        const q = v.input.quantities[0];
        const key = `${q.inventoryItemId}|${q.locationId}`;
        if (this.concurrentStockChanges > 0) {
          this.concurrentStockChanges--;
          this.inventory.set(key, (this.inventory.get(key) ?? 0) - 1); // a sale happened meanwhile
        }
        const current = this.inventory.get(key) ?? 0;
        const expected = q.changeFromQuantity ?? q.compareQuantity;
        let result: unknown;
        if (expected !== undefined && expected !== current) {
          result = { inventorySetQuantities: { inventoryAdjustmentGroup: null, userErrors: [{ field: ["input", "quantities", "0", "changeFromQuantity"], message: "The quantity has changed since it was read (stale changeFromQuantity)", code: "CHANGE_FROM_QUANTITY_STALE" }] } };
        } else {
          this.inventory.set(key, q.quantity);
          result = { inventorySetQuantities: { inventoryAdjustmentGroup: { id: this.nextId("InventoryAdjustmentGroup") }, userErrors: [] } };
        }
        this.idempotency.set(v.idempotencyKey, result);
        return result;
      }
      case "MizanFulfillmentCreate": {
        const foIds = v.fulfillment.lineItemsByFulfillmentOrder.map((x: { fulfillmentOrderId: string }) => x.fulfillmentOrderId);
        const order = [...this.orders.values()].find((o) => o.fulfillmentOrders.some((f) => foIds.includes(f.id)));
        if (!order) return { fulfillmentCreate: { fulfillment: null, userErrors: [{ field: ["fulfillment"], message: "Fulfillment order not found" }] } };
        const open = order.fulfillmentOrders.filter((f) => foIds.includes(f.id) && f.status === "OPEN");
        if (!open.length) return { fulfillmentCreate: { fulfillment: null, userErrors: [{ field: ["fulfillment"], message: "Fulfillment order is not open" }] } };
        open.forEach((f) => (f.status = "CLOSED"));
        const f = { id: this.nextId("Fulfillment"), status: "SUCCESS", trackingInfo: [v.fulfillment.trackingInfo] };
        order.fulfillments.push(f);
        order.updatedAt = this.touch();
        return { fulfillmentCreate: { fulfillment: f, userErrors: [] } };
      }
      case "MizanFulfillmentEvents": {
        const f = [...this.orders.values()].flatMap((o) => o.fulfillments).find((x) => x.id === v.id);
        return { fulfillment: f ? { id: f.id, status: f.status, events: { nodes: (f.events ?? []).map(({ id, status, happenedAt }) => ({ id, status, happenedAt })) } } : null };
      }
      case "MizanFulfillmentEventCreate": {
        const e = v.fulfillmentEvent as { fulfillmentId: string; status: string; happenedAt: string; message?: string };
        if (!this.eventStatuses.has(e.status)) {
          throw Object.assign(new Error("invalid variable"), { graphqlErrors: [{ message: `Variable $fulfillmentEvent of type FulfillmentEventInput! was provided invalid value for status (Expected "${e.status}" to be one of: ${[...this.eventStatuses].join(", ")})`, extensions: { code: "INVALID_VARIABLE" } }] });
        }
        const order = [...this.orders.values()].find((o) => o.fulfillments.some((x) => x.id === e.fulfillmentId));
        const f = order?.fulfillments.find((x) => x.id === e.fulfillmentId);
        if (!order || !f) return { fulfillmentEventCreate: { fulfillmentEvent: null, userErrors: [{ field: ["fulfillmentEvent", "fulfillmentId"], message: "Fulfillment does not exist" }] } };
        const event = { id: this.nextId("FulfillmentEvent"), status: e.status, happenedAt: e.happenedAt, ...(e.message ? { message: e.message } : {}) };
        (f.events ??= []).push(event);
        order.updatedAt = this.touch();
        return { fulfillmentEventCreate: { fulfillmentEvent: event, userErrors: [] } };
      }
      case "MizanOrderMarkPaid": {
        const o = this.orders.get(v.input.id);
        if (!o) return { orderMarkAsPaid: { order: null, userErrors: [{ field: ["id"], message: "Order does not exist" }] } };
        if (o.displayFinancialStatus === "PAID") return { orderMarkAsPaid: { order: null, userErrors: [{ field: ["id"], message: "Order is already paid" }] } };
        o.displayFinancialStatus = "PAID";
        o.received = o.total;
        o.updatedAt = this.touch();
        return { orderMarkAsPaid: { order: { id: o.id, displayFinancialStatus: "PAID" }, userErrors: [] } };
      }
      case "MizanWebhookSubscriptions": {
        const nodes = [...this.webhooks].map(([id, w]) => ({ id, topic: w.topic, uri: w.uri, endpoint: { __typename: "WebhookHttpEndpoint", callbackUrl: w.uri } }));
        return { webhookSubscriptions: { nodes } };
      }
      case "MizanWebhookCreate": {
        const uri = String(v.sub?.uri ?? "");
        if (!uri.startsWith("https://")) return { webhookSubscriptionCreate: { webhookSubscription: null, userErrors: [{ field: ["webhookSubscription", "callbackUrl"], message: "Address protocol http:// is not supported" }] } };
        if ([...this.webhooks.values()].some((w) => w.topic === v.topic && w.uri === uri)) {
          return { webhookSubscriptionCreate: { webhookSubscription: null, userErrors: [{ field: ["webhookSubscription", "callbackUrl"], message: "Address for this topic has already been taken" }] } };
        }
        const id = this.nextId("WebhookSubscription");
        this.webhooks.set(id, { topic: v.topic, uri });
        return { webhookSubscriptionCreate: { webhookSubscription: { id }, userErrors: [] } };
      }
      case "MizanWebhookDelete": {
        if (!this.webhooks.delete(v.id)) return { webhookSubscriptionDelete: { deletedWebhookSubscriptionId: null, userErrors: [{ field: ["id"], message: "Webhook subscription does not exist" }] } };
        return { webhookSubscriptionDelete: { deletedWebhookSubscriptionId: v.id, userErrors: [] } };
      }
      case "MizanOrderEditBegin": {
        const o = this.orders.get(v.id);
        if (!o) return { orderEditBegin: { calculatedOrder: null, userErrors: [{ field: ["id"], message: "Order does not exist" }] } };
        if (o.cancelledAt) return { orderEditBegin: { calculatedOrder: null, userErrors: [{ field: ["id"], message: "Cannot edit a cancelled order" }] } };
        const id = this.nextId("CalculatedOrder");
        this.edits.set(id, { orderId: o.id, adds: [] });
        return { orderEditBegin: { calculatedOrder: { id }, userErrors: [] } };
      }
      case "MizanOrderEditAddVariant": {
        const e = this.edits.get(v.id);
        const variant = [...this.products.values()].flatMap((p) => p.variants.map((x) => ({ p, x }))).find(({ x }) => x.id === v.variantId);
        if (!e) return { orderEditAddVariant: { calculatedLineItem: null, userErrors: [{ field: ["id"], message: "Calculated order does not exist" }] } };
        if (!variant) return { orderEditAddVariant: { calculatedLineItem: null, userErrors: [{ field: ["variantId"], message: "Variant does not exist" }] } };
        const stock = [...this.inventory.entries()].filter(([k]) => k.startsWith(variant.x.inventoryItemId)).reduce((n, [, q]) => n + q, 0);
        if (stock < v.quantity) return { orderEditAddVariant: { calculatedLineItem: null, userErrors: [{ field: ["variantId"], message: "is out of stock" }] } };
        const lineId = this.nextId("CalculatedLineItem");
        e.adds.push({ lineId, variantId: v.variantId, qty: v.quantity, pct: 0 });
        return { orderEditAddVariant: { calculatedLineItem: { id: lineId }, calculatedOrder: { id: v.id }, userErrors: [] } };
      }
      case "MizanOrderEditAddLineItemDiscount": {
        const add = this.edits.get(v.id)?.adds.find((a) => a.lineId === v.lineItemId);
        if (!add) return { orderEditAddLineItemDiscount: { calculatedOrder: null, userErrors: [{ field: ["lineItemId"], message: "Line item does not exist" }] } };
        add.pct = Number(v.discount?.percentValue ?? 0);
        return { orderEditAddLineItemDiscount: { calculatedOrder: { id: v.id }, userErrors: [] } };
      }
      case "MizanOrderEditCommit": {
        const e = this.edits.get(v.id);
        const o = e ? this.orders.get(e.orderId) : undefined;
        if (!e || !o) return { orderEditCommit: { order: null, userErrors: [{ field: ["id"], message: "Calculated order does not exist" }] } };
        for (const a of e.adds) {
          const { p, x } = [...this.products.values()].flatMap((p) => p.variants.map((x) => ({ p, x }))).find(({ x }) => x.id === a.variantId)!;
          const unit = (Number(x.price) * (1 - a.pct / 100)).toFixed(2);
          o.lines.push({ id: this.nextId("LineItem"), title: p.title, sku: x.sku, quantity: a.qty, price: unit });
          o.total = (Number(o.total) + Number(unit) * a.qty).toFixed(2);
        }
        this.edits.delete(v.id);
        this.committedEdits++;
        o.updatedAt = this.touch();
        return { orderEditCommit: { order: { id: o.id }, userErrors: [] } };
      }
      case "MizanOrderCancel": {
        const o = this.orders.get(v.orderId);
        const err = (message: string, code: string) => ({ orderCancel: { job: null, orderCancelUserErrors: [{ field: ["orderId"], message, code }], userErrors: [] } });
        if (!o) return err("Order does not exist", "NOT_FOUND");
        if (o.cancelledAt) return err("Order has already been cancelled", "INVALID");
        o.cancelledAt = this.touch();
        o.updatedAt = o.cancelledAt;
        this.cancels++;
        return { orderCancel: { job: { id: this.nextId("Job") }, orderCancelUserErrors: [], userErrors: [] } };
      }
      case "MizanTagsAdd": {
        const o = this.orders.get(v.id);
        if (o) for (const t of v.tags) if (!o.tags.includes(t)) o.tags.push(t);
        return { tagsAdd: { node: { id: v.id }, userErrors: [] } };
      }
      default:
        return {};
    }
  }

  count(op: string) {
    return this.calls.filter((c) => c.op === op).length;
  }
}

import { createHash } from "node:crypto";
import { signWoo } from "../../src/connectors/woocommerce/webhooks.js";
import { hang, json, type FakeClock } from "./clock.js";

/**
 * In-memory WooCommerce REST API v3 with the quirks of real WordPress hosting:
 * - 5xx, 429 / 503 with Retry-After, hangs, dropped connections;
 * - a maintenance page (HTML, 200) and PHP notices printed before the JSON;
 * - hosts that strip the Authorization header (only query-string keys work);
 * - a write carried out whose answer never arrives ("lost");
 * - webhooks delivered twice or out of order, a delivery id that repeats within the same second,
 *   the unsigned save-time ping, and webhooks disabled after failed deliveries;
 * - an older payload shape: no `*_gmt` dates, line prices as strings.
 */
type Fault = "500" | "503" | "429" | "timeout" | "network" | "html" | "notice" | "lost";
export type WooPayment = "cod" | "card" | "bank" | "bnpl" | "manual" | "free" | "fawry";

export interface WooOrder {
  id: number; number: string; status: string; currency: string; total: string; shipping_total: string;
  date_created: string; date_created_gmt?: string; date_modified: string; date_modified_gmt?: string; date_paid: string | null; date_paid_gmt?: string | null;
  payment_method: string; payment_method_title: string; transaction_id: string;
  billing: Record<string, string>; shipping: Record<string, string>;
  line_items: Array<{ id: number; name: string; product_id: number; variation_id: number; quantity: number; subtotal: string; total: string; sku: string; price: number | string }>;
  refunds: Array<{ id: number; reason: string; total: string }>;
  meta_data: unknown[];
  /** Delivery charges; `shipping_total` is their sum (O3 edits them). */
  shipping_lines?: Array<{ id: number; method_id: string | null; method_title: string; total: string }>;
}

const PAY: Record<WooPayment, { method: string; title: string }> = {
  cod: { method: "cod", title: "الدفع عند الاستلام" },
  card: { method: "paymob", title: "Credit card (Paymob)" },
  bank: { method: "bacs", title: "Direct bank transfer" },
  bnpl: { method: "tabby_installments", title: "Tabby — pay in 4" },
  manual: { method: "", title: "" },
  free: { method: "", title: "" },
  fawry: { method: "fawry_pay", title: "Fawry reference" },
};

export interface WooProduct {
  id: number; name: string; type: "simple" | "variable"; status: string; sku: string; global_unique_id: string;
  price: string; regular_price: string; sale_price: string; manage_stock: boolean; stock_quantity: number | null;
  date_modified: string; date_modified_gmt: string; description: string; tags: Array<{ id: number; name: string }>; categories: Array<{ id: number; name: string }>;
  variations: number[]; slug: string;
  /** Gallery in the store's order: WooCommerce's first picture is the product's main one. */
  images: Array<{ id: number; src: string; alt: string; name: string }>;
  attributes: Array<{ id: number; name: string; options: string[]; variation: boolean; visible: boolean }>;
}
export interface WooVariation {
  id: number; sku: string; global_unique_id: string; price: string; regular_price: string; sale_price: string;
  manage_stock: boolean | "parent"; stock_quantity: number | null; attributes: Array<{ name: string; option: string }>; status: string;
  /** WooCommerce sends an empty image as id 0. */
  image: { id: number; src: string } | null;
}

export class FakeWooCommerce {
  readonly consumerKey = "ck_fake_0123456789";
  readonly consumerSecret = "cs_fake_9876543210";
  readonly webhookSecret = "whsec-woo &amp; friends";
  orders = new Map<number, WooOrder>();
  products = new Map<number, WooProduct>();
  variationsOf = new Map<number, WooVariation[]>();
  /** P2: product and variation updates received. */
  productWrites = 0;
  /** P2: the store's product tags (id → name); "abaya" is every new product's. */
  readonly tagNames = new Map<number, string>([[1, "abaya"]]);
  tagCreates = 0;
  webhooks = new Map<number, { id: number; topic: string; delivery_url: string; status: string; secret: string }>();
  calls: Array<{ method: string; path: string }> = [];
  faults: Array<{ path?: string; fault: Fault }> = [];
  randomFaultRate = 0;
  /** The host drops the Authorization header: only query-string keys get through. */
  stripAuthHeader = false;
  /** Older payloads: no `*_gmt` dates, prices as strings. */
  legacyShape = false;
  /** Faults served, by kind (chaos tests check they really happened). */
  injected: Partial<Record<Fault, number>> = {};
  /** Notes on orders (internal), and how many order status writes were carried out. */
  notes = new Map<number, string[]>();
  orderWrites = 0;
  /** Stock writes carried out. */
  stockWrites = 0;
  /** Webhook POSTs carried out (to check nothing is created twice). */
  webhookCreates = 0;
  private seq = 7000;

  constructor(private readonly clock: FakeClock, private readonly random: () => number = Math.random, readonly host = "shop.fake-woo.test") {}

  get siteUrl() {
    return `https://${this.host}`;
  }

  private stamp() {
    return new Date(this.clock.now()).toISOString().slice(0, 19); // WooCommerce: no zone, no milliseconds
  }

  addOrder(o: Partial<{ payment: WooPayment; total: string; city: string; state: string; phone: string; billingOnly: boolean; downloadable: boolean; product: WooProduct }> = {}) {
    const id = ++this.seq;
    const payment = o.payment ?? "cod";
    const total = payment === "free" ? "0.00" : (o.total ?? "1250.00");
    const now = this.stamp();
    // WooCommerce's own gateways: COD → processing (and date_paid is stamped!), bank → on-hold, online → paid at once or pending.
    const status = payment === "cod" ? (o.downloadable ? "on-hold" : "processing") : payment === "bank" ? "on-hold"
      : payment === "card" || payment === "bnpl" || payment === "free" ? "processing" : "pending";
    const paidAt = status === "processing" ? now : null;
    const address = { first_name: "منى", last_name: "عادل", company: "", address_1: "12 شارع عباس العقاد", address_2: "الدور 3", city: o.city ?? "مدينة نصر", state: o.state ?? "EGC", postcode: "11765", country: "EG" };
    const order: WooOrder = {
      id, number: String(id), status, currency: "EGP", total, shipping_total: "50.00",
      date_created: now, date_created_gmt: now, date_modified: now, date_modified_gmt: now, date_paid: paidAt, date_paid_gmt: paidAt,
      payment_method: PAY[payment].method, payment_method_title: PAY[payment].title, transaction_id: payment === "card" ? `pm_${id}` : "",
      billing: { ...address, email: "mona@example.com", phone: o.phone ?? "01001234821" },
      shipping: o.billingOnly ? { first_name: "", last_name: "", company: "", address_1: "", address_2: "", city: "", state: "", postcode: "", country: "", phone: "" } : { ...address, phone: "" },
      line_items: [o.product
        ? { id: id * 10 + 1, name: o.product.name, product_id: o.product.id, variation_id: 0, quantity: 2, subtotal: "1200.00", total: "1200.00", sku: o.product.sku, price: 600 }
        : { id: id * 10 + 1, name: "عباية سادة", product_id: 501, variation_id: 0, quantity: 2, subtotal: "1200.00", total: "1200.00", sku: "AB-1", price: 600 }],
      refunds: [], meta_data: [], shipping_lines: [{ id: id * 10 + 9, method_id: "flat_rate", method_title: "شحن", total: "50.00" }],
    };
    this.orders.set(id, order);
    return order;
  }

  /** A simple product, or a variable one with sizes (the first shares the product's stock: `manage_stock: "parent"`). */
  addProduct(p: Partial<{ name: string; price: string; sale: string; sku: string; gtin: string; stock: number | null; sizes: string[]; status: string; images: number }> = {}) {
    const id = ++this.seq;
    const now = this.stamp();
    const variable = Boolean(p.sizes?.length);
    const price = p.price ?? "600.00";
    const product: WooProduct = {
      id, name: p.name ?? "عباية سادة", type: variable ? "variable" : "simple", status: p.status ?? "publish", sku: p.sku ?? (variable ? "" : `AB-${id}`), global_unique_id: p.gtin ?? "",
      price: p.sale ?? price, regular_price: price, sale_price: p.sale ?? "", manage_stock: p.stock !== null, stock_quantity: p.stock === undefined ? 10 : p.stock,
      date_modified: now, date_modified_gmt: now, description: "<p>قماش كريب</p>", tags: [{ id: 1, name: "abaya" }], categories: [{ id: 2, name: "Abayas" }], variations: [],
      slug: `abaya-${id}`, images: Array.from({ length: p.images ?? 0 }, (_, i) => ({ id: 9000 + id * 10 + i, src: `${this.siteUrl}/wp-content/uploads/abaya-${id}-${i + 1}.jpg`, alt: i === 0 ? "عباية" : "", name: `abaya-${i + 1}` })),
      attributes: variable ? [{ id: 1, name: "Size", options: p.sizes!, variation: true, visible: true }, { id: 0, name: "Fabric", options: ["Crepe"], variation: false, visible: true }] : [],
    };
    if (variable) {
      const vs = p.sizes!.map((size, i): WooVariation => ({
        id: ++this.seq, sku: `AB-${id}-${size}`, global_unique_id: i === 0 ? "6221234567890" : "", price, regular_price: price, sale_price: "",
        manage_stock: i === 0 ? "parent" : true, stock_quantity: i === 0 ? null : 3 + i, attributes: [{ name: "Size", option: size }], status: "publish",
        image: product.images[i] ? { id: product.images[i]!.id, src: product.images[i]!.src } : { id: 0, src: "" },
      }));
      product.variations = vs.map((v) => v.id);
      this.variationsOf.set(id, vs);
    }
    this.products.set(id, product);
    return product;
  }

  updateProduct(id: number, change: Partial<WooProduct>) {
    const p = this.products.get(id)!;
    Object.assign(p, change);
    p.date_modified = p.date_modified_gmt = this.stamp();
  }

  private touch(o: WooOrder) {
    o.date_modified = o.date_modified_gmt = this.stamp();
  }

  /** The merchant saw the transfer (or Fawry confirmed): processing, date_paid stamped. */
  paid(id: number) {
    const o = this.orders.get(id)!;
    o.status = "processing";
    o.date_paid = o.date_paid_gmt = this.stamp();
    this.touch(o);
  }

  setStatus(id: number, status: string) {
    const o = this.orders.get(id)!;
    o.status = status;
    this.touch(o);
  }

  refund(id: number, amount: string) {
    const o = this.orders.get(id)!;
    o.refunds.push({ id: ++this.seq, reason: "", total: `-${amount}` }); // negative, as WooCommerce sends them
    if (Number(amount) >= Number(o.total)) o.status = "refunded";
    this.touch(o);
  }

  /** Deleted for good (not the trash). */
  remove(id: number) {
    this.orders.delete(id);
  }

  /** WooCommerce gave up on the webhooks after failed deliveries. */
  disableWebhooks() {
    for (const w of this.webhooks.values()) w.status = "disabled";
  }

  /** A signed delivery for an order, as WooCommerce sends it. */
  webhook(topic: "order.created" | "order.updated" | "order.deleted" | "product.created" | "product.updated" | "product.deleted", order: WooOrder | WooProduct | { id: number }) {
    const body = JSON.stringify(topic.endsWith(".deleted") ? { id: order.id } : topic.startsWith("product.") ? order : this.view(order as WooOrder));
    const [resource, event] = topic.split(".");
    const hook = [...this.webhooks.values()].find((w) => w.topic === topic && w.status === "active");
    const hookId = hook?.id ?? 1;
    return {
      body,
      headers: {
        "x-wc-webhook-source": `${this.siteUrl}/`, "x-wc-webhook-topic": topic, "x-wc-webhook-resource": resource!, "x-wc-webhook-event": event!,
        "x-wc-webhook-signature": signWoo(body, hook?.secret || this.webhookSecret), // signed with the webhook's own secret, as WooCommerce does "x-wc-webhook-id": String(hookId),
        // wp_hash(id . strtotime('now')): the same for two deliveries in one second.
        "x-wc-webhook-delivery-id": createHash("md5").update(`${hookId}${Math.floor(this.clock.now() / 1000)}`).digest("hex"),
      } as Record<string, string>,
    };
  }

  ping(webhookId = 1) {
    return { body: `webhook_id=${webhookId}`, headers: { "content-type": "application/x-www-form-urlencoded" } as Record<string, string> };
  }

  private view(o: WooOrder): WooOrder {
    const copy = structuredClone(o);
    if (this.legacyShape) {
      delete copy.date_created_gmt;
      delete copy.date_modified_gmt;
      delete copy.date_paid_gmt;
      for (const li of copy.line_items) li.price = String(li.price);
    }
    return copy;
  }

  private authorized(url: URL, init: RequestInit) {
    const h = new Headers(init.headers);
    const basic = this.stripAuthHeader ? null : h.get("authorization");
    if (basic === `Basic ${Buffer.from(`${this.consumerKey}:${this.consumerSecret}`).toString("base64")}`) return true;
    return url.searchParams.get("consumer_key") === this.consumerKey && url.searchParams.get("consumer_secret") === this.consumerSecret;
  }

  handler = async (url: URL, init: RequestInit): Promise<Response> => {
    const method = (init.method ?? "GET").toUpperCase();
    const path = url.pathname.replace(/^\/wp-json\/wc\/v3/, "");
    this.calls.push({ method, path });
    const fi = this.faults.findIndex((f) => !f.path || path.startsWith(f.path));
    let fault: Fault | undefined = fi >= 0 ? this.faults.splice(fi, 1)[0]!.fault : undefined;
    if (!fault && this.randomFaultRate && this.random() < this.randomFaultRate) {
      const pool: Fault[] = method === "GET" ? ["500", "503", "429", "timeout", "network", "html", "notice"] : ["500", "503", "429", "network", "lost"];
      fault = pool[Math.floor(this.random() * pool.length)];
    }
    if (fault) this.injected[fault] = (this.injected[fault] ?? 0) + 1;
    if (fault === "500") return json(500, { code: "internal_server_error", message: "There has been a critical error on this website.", data: { status: 500 } });
    if (fault === "503") return new Response("<html><body>Service Unavailable</body></html>", { status: 503, headers: { "retry-after": "2", "content-type": "text/html" } });
    if (fault === "429") return json(429, { code: "too_many_requests", message: "Too many requests", data: { status: 429 } }, { "retry-after": "1" });
    if (fault === "timeout") return hang(init);
    if (fault === "network") throw new TypeError("fetch failed: ECONNRESET");
    if (fault === "html") return new Response("<!DOCTYPE html><html><body><h1>Briefly unavailable for scheduled maintenance.</h1></body></html>", { status: 200, headers: { "content-type": "text/html" } });

    if (!this.authorized(url, init)) return json(401, { code: "woocommerce_rest_cannot_view", message: "Sorry, you cannot list resources.", data: { status: 401 } });
    const res = this.route(method, path, url, init);
    if (fault === "lost") return hang(init); // carried out, the answer never comes
    if (fault === "notice") {
      const text = await res.text();
      return new Response(`<br />\n<b>Deprecated</b>:  Creation of dynamic property is deprecated in <b>/wp-content/plugins/some-plugin.php</b> on line <b>42</b><br />\n${text}`, { status: res.status, headers: res.headers });
    }
    return res;
  };

  private route(method: string, path: string, url: URL, init: RequestInit): Response {
    const body = typeof init.body === "string" && init.body ? JSON.parse(init.body) : {};
    let m: RegExpMatchArray | null;
    if (method === "GET" && (m = path.match(/^\/orders\/(\d+)$/))) {
      const o = this.orders.get(Number(m[1]));
      return o ? json(200, this.view(o)) : json(404, { code: "woocommerce_rest_shop_order_invalid_id", message: "Invalid ID.", data: { status: 404 } });
    }
    if (method === "GET" && path === "/orders") {
      const after = url.searchParams.get("modified_after");
      const perPage = Math.min(100, Number(url.searchParams.get("per_page") ?? 10));
      const page = Number(url.searchParams.get("page") ?? 1);
      const since = after ? Date.parse(`${after}Z`) : 0;
      const all = [...this.orders.values()].filter((o) => Date.parse(`${o.date_modified_gmt ?? o.date_modified}Z`) > since)
        .sort((a, b) => (a.date_modified_gmt ?? a.date_modified).localeCompare(b.date_modified_gmt ?? b.date_modified) || a.id - b.id);
      const pages = Math.max(1, Math.ceil(all.length / perPage));
      return json(200, all.slice((page - 1) * perPage, page * perPage).map((o) => this.view(o)), { "x-wp-total": String(all.length), "x-wp-totalpages": String(pages) });
    }
    if (method === "GET" && (m = path.match(/^\/products\/(\d+)\/variations$/))) {
      const all = this.variationsOf.get(Number(m[1])) ?? [];
      const perPage = Math.min(100, Number(url.searchParams.get("per_page") ?? 10));
      const page = Number(url.searchParams.get("page") ?? 1);
      return json(200, all.slice((page - 1) * perPage, page * perPage), { "x-wp-totalpages": String(Math.max(1, Math.ceil(all.length / perPage))) });
    }
    if (path === "/products/tags") {
      if (method === "GET") {
        const q = (url.searchParams.get("search") ?? "").toLowerCase();
        return json(200, [...this.tagNames].filter(([, n]) => n.toLowerCase().includes(q)).map(([id, name]) => ({ id, name, slug: name })));
      }
      if (method === "POST") {
        const name = String(body.name ?? "").trim();
        if ([...this.tagNames.values()].some((n) => n.toLowerCase() === name.toLowerCase())) {
          return json(400, { code: "term_exists", message: "A term with the name provided already exists.", data: { status: 400 } });
        }
        const id = ++this.seq;
        this.tagNames.set(id, name);
        this.tagCreates++;
        return json(201, { id, name, slug: name });
      }
    }
    if (method === "GET" && (m = path.match(/^\/products\/(\d+)$/))) {
      const p = this.products.get(Number(m[1]));
      // Like WooCommerce, a variation is readable here too, with its parent.
      if (!p) {
        for (const [parent, vs] of this.variationsOf) {
          const v = vs.find((x) => x.id === Number(m![1]));
          if (v) return json(200, { ...v, type: "variation", parent_id: parent });
        }
      }
      return p ? json(200, p) : json(404, { code: "woocommerce_rest_product_invalid_id", message: "Invalid ID.", data: { status: 404 } });
    }
    if (method === "GET" && path === "/products") {
      const after = url.searchParams.get("modified_after");
      const perPage = Math.min(100, Number(url.searchParams.get("per_page") ?? 10));
      const page = Number(url.searchParams.get("page") ?? 1);
      const since = after ? Date.parse(`${after}Z`) : -Infinity;
      const all = [...this.products.values()].filter((p) => Date.parse(`${p.date_modified_gmt}Z`) > since)
        .sort((a, b) => a.date_modified_gmt.localeCompare(b.date_modified_gmt) || a.id - b.id);
      return json(200, all.slice((page - 1) * perPage, page * perPage), { "x-wp-totalpages": String(Math.max(1, Math.ceil(all.length / perPage))) });
    }
    if (method === "PUT" && (m = path.match(/^\/orders\/(\d+)$/))) {
      const o = this.orders.get(Number(m[1]));
      if (!o) return json(404, { code: "woocommerce_rest_shop_order_invalid_id", message: "Invalid ID.", data: { status: 404 } });
      if (body.status) o.status = body.status;
      // O3: lines (quantity 0 removes one), new items, delivery charges, the address, meta.
      // Like WooCommerce, totals are calculated again; here the total moves by what changed.
      let delta = 0;
      for (const li of (body.line_items ?? []) as Array<Record<string, unknown>>) {
        if (li.id) {
          const line = o.line_items.find((x) => x.id === Number(li.id));
          if (!line) return json(400, { code: "woocommerce_rest_invalid_item_id", message: "Order item ID provided is not associated with order.", data: { status: 400 } });
          const q = Number(li.quantity ?? line.quantity);
          const total = li.total !== undefined ? Number(li.total) : Number(line.price) * q;
          delta += total - Number(line.total);
          Object.assign(line, { quantity: q, total: total.toFixed(2), subtotal: total.toFixed(2), price: q ? total / q : Number(line.price) });
        } else {
          const vid = Number(li.variation_id ?? 0);
          const pid = Number(li.product_id ?? 0);
          const product = this.products.get(pid);
          const variation = vid ? this.variationsOf.get(pid)?.find((x) => x.id === vid) : undefined;
          if (!product || (vid && !variation)) return json(400, { code: "woocommerce_rest_invalid_product_id", message: "Invalid product ID.", data: { status: 400 } });
          const q = Number(li.quantity ?? 1);
          const unit = Number(variation?.price ?? product.price);
          const total = li.total !== undefined ? Number(li.total) : unit * q;
          delta += total;
          o.line_items.push({ id: o.id * 10 + 1 + o.line_items.length + this.orderWrites * 10, name: product.name, product_id: pid, variation_id: vid, quantity: q, subtotal: total.toFixed(2), total: total.toFixed(2), sku: variation?.sku ?? product.sku, price: total / q });
        }
      }
      o.line_items = o.line_items.filter((x) => x.quantity > 0);
      for (const sl of (body.shipping_lines ?? []) as Array<Record<string, unknown>>) {
        const lines = (o.shipping_lines ??= []);
        const existing = sl.id ? lines.find((x) => x.id === Number(sl.id)) : undefined;
        if (existing) {
          if (sl.method_id === null) { delta -= Number(existing.total); lines.splice(lines.indexOf(existing), 1); continue; }
          delta += Number(sl.total ?? existing.total) - Number(existing.total);
          existing.total = Number(sl.total ?? existing.total).toFixed(2);
        } else {
          delta += Number(sl.total ?? 0);
          lines.push({ id: o.id * 10 + 8, method_id: String(sl.method_id ?? "flat_rate"), method_title: String(sl.method_title ?? ""), total: Number(sl.total ?? 0).toFixed(2) });
        }
      }
      if (body.shipping_lines) o.shipping_total = (o.shipping_lines ?? []).reduce((n, x) => n + Number(x.total), 0).toFixed(2);
      if (body.shipping) o.shipping = { ...o.shipping, ...body.shipping };
      for (const m of (body.meta_data ?? []) as Array<{ key: string; value: unknown }>) {
        const list = o.meta_data as Array<{ id: number; key: string; value: unknown }>;
        const had = list.find((x) => x.key === m.key);
        if (had) had.value = m.value; else list.push({ id: list.length + 1, key: m.key, value: m.value });
      }
      if (delta) o.total = (Number(o.total) + delta).toFixed(2);
      this.orderWrites++;
      this.touch(o);
      return json(200, this.view(o));
    }
    if ((m = path.match(/^\/orders\/(\d+)\/notes$/))) {
      const id = Number(m[1]);
      if (!this.orders.has(id)) return json(404, { code: "woocommerce_rest_shop_order_invalid_id", message: "Invalid ID.", data: { status: 404 } });
      const list = this.notes.get(id) ?? [];
      if (method === "GET") return json(200, list.map((note, i) => ({ id: i + 1, note, customer_note: false })));
      if (method === "POST") { list.push(String(body.note)); this.notes.set(id, list); return json(201, { id: list.length, note: body.note, customer_note: false }); }
    }
    if (method === "PUT" && (m = path.match(/^\/products\/(\d+)(?:\/variations\/(\d+))?$/))) {
      const [, pid, vid] = m;
      const p = this.products.get(Number(pid));
      const v = vid ? this.variationsOf.get(Number(pid))?.find((x) => x.id === Number(vid)) : undefined;
      if (!p || (vid && !v)) return json(404, { code: vid ? "woocommerce_rest_product_variation_invalid_id" : "woocommerce_rest_product_invalid_id", message: "Invalid ID.", data: { status: 404 } });
      const target = (v ?? p) as { manage_stock: boolean | "parent"; stock_quantity: number | null };
      if (body.manage_stock !== undefined) target.manage_stock = body.manage_stock;
      if (body.stock_quantity !== undefined) target.stock_quantity = body.stock_quantity;
      if (body.manage_stock !== undefined || body.stock_quantity !== undefined) this.stockWrites++;
      // P2: the product's own fields and prices, like WooCommerce (sale price empty = no sale).
      const priced = (v ?? p) as { price: string; regular_price: string; sale_price: string };
      if (body.regular_price !== undefined) priced.regular_price = String(body.regular_price);
      if (body.sale_price !== undefined) priced.sale_price = String(body.sale_price);
      if (body.regular_price !== undefined || body.sale_price !== undefined) priced.price = priced.sale_price || priced.regular_price;
      if (!v) {
        if (body.name !== undefined) p.name = String(body.name);
        if (body.description !== undefined) p.description = String(body.description);
        if (body.status !== undefined) p.status = String(body.status);
        // Like WooCommerce: tags by id; a name alone is dropped.
        if (body.tags !== undefined) p.tags = (body.tags as Array<{ id?: number; name?: string }>).filter((t) => t.id && this.tagNames.has(Number(t.id))).map((t) => ({ id: Number(t.id), name: this.tagNames.get(Number(t.id))! }));
        if (body.images !== undefined) {
          // Only the pictures sent stay, in that order; an unknown id is refused.
          const byId = new Map(p.images.map((x) => [x.id, x]));
          const next = (body.images as Array<{ id: number }>).map((x) => byId.get(Number(x.id)));
          if (next.some((x) => !x)) return json(400, { code: "woocommerce_product_invalid_image_id", message: "Invalid image ID.", data: { status: 400 } });
          p.images = next as typeof p.images;
        }
      }
      this.productWrites++;
      p.date_modified = p.date_modified_gmt = this.stamp();
      return json(200, v ?? p);
    }
    if (method === "GET" && path === "/webhooks") return json(200, [...this.webhooks.values()].map(({ secret: _s, ...w }) => w), { "x-wp-totalpages": "1" });
    if (method === "POST" && path === "/webhooks") {
      const id = ++this.seq;
      this.webhooks.set(id, { id, topic: body.topic, delivery_url: body.delivery_url, status: body.status ?? "active", secret: body.secret ?? "" });
      this.webhookCreates++;
      return json(201, { id, topic: body.topic, delivery_url: body.delivery_url, status: "active" });
    }
    if (method === "PUT" && (m = path.match(/^\/webhooks\/(\d+)$/))) {
      const w = this.webhooks.get(Number(m[1]));
      if (!w) return json(404, { code: "woocommerce_rest_webhook_invalid_id", message: "Invalid ID.", data: { status: 404 } });
      Object.assign(w, body.status ? { status: body.status } : {}, body.secret ? { secret: body.secret } : {});
      return json(200, { id: w.id, topic: w.topic, delivery_url: w.delivery_url, status: w.status });
    }
    return json(404, { code: "rest_no_route", message: "No route was found matching the URL and request method.", data: { status: 404 } });
  }
}

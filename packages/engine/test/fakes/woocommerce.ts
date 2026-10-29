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

export class FakeWooCommerce {
  readonly consumerKey = "ck_fake_0123456789";
  readonly consumerSecret = "cs_fake_9876543210";
  readonly webhookSecret = "whsec-woo &amp; friends";
  orders = new Map<number, WooOrder>();
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

  addOrder(o: Partial<{ payment: WooPayment; total: string; city: string; state: string; phone: string; billingOnly: boolean; downloadable: boolean }> = {}) {
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
      line_items: [{ id: id * 10 + 1, name: "عباية سادة", product_id: 501, variation_id: 0, quantity: 2, subtotal: "1200.00", total: "1200.00", sku: "AB-1", price: 600 }],
      refunds: [], meta_data: [],
    };
    this.orders.set(id, order);
    return order;
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
  webhook(topic: "order.created" | "order.updated" | "order.deleted", order: WooOrder | { id: number }) {
    const body = JSON.stringify(topic === "order.deleted" ? { id: order.id } : this.view(order as WooOrder));
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

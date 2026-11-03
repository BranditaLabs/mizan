import { createHmac } from "node:crypto";
import { hang, json, type FakeClock } from "./clock.js";

/**
 * A fake Paymob Accept API (E14-2a), with what the docs and Postman collection say and what goes
 * wrong in practice:
 * - two credentials: `Token <secret key>` on intentions, `Bearer <auth token>` on reads; an auth
 *   token from `POST /api/auth/tokens` lasts 60 minutes, then 401;
 * - `POST /v1/intention/`: amounts are integers in minor units; 404 "Integration ID/Name does not
 *   exist" for an id of the other mode or another account; 400 without `billing_data.phone_number`
 *   or an item without a name; no idempotency on `special_reference` (each create is a new
 *   intention, as far as anyone knows);
 * - faults: 500, 503, 429 with Retry-After, a hang, and "lost" (the intention is created, the
 *   answer never comes);
 * - `legacyShape`: the answer without `intention_order_id` (the order id only under payment_keys).
 */
type Fault = "500" | "503" | "429" | "timeout" | "lost";

export interface FakeIntention { id: string; orderId: number; clientSecret: string; amount: number; currency: string; reference: string; methods: number[]; body: Record<string, unknown> }

export class FakePaymob {
  readonly host = "accept.paymob.com";
  readonly secretKey = "sk_test_fake_secret";
  readonly publicKey = "pk_test_fake_public";
  readonly apiKey = "api_key_fake";
  /** This account's integration ids, in the keys' mode. 9999 is the other mode's (404). */
  readonly integrations = { card: 4097558, wallet: 4097559, kiosk: 4097560 };
  readonly intentions = new Map<string, FakeIntention>();
  readonly transactions = new Map<string, Record<string, unknown>>();
  faults: Array<{ path?: string; fault: Fault }> = [];
  randomFaultRate = 0;
  legacyShape = false;
  private tokens = new Map<string, number>();
  private seq = 0;
  creates = 0;

  constructor(private readonly clock: FakeClock, private readonly random: () => number = Math.random) {}

  /** Intentions per Mizan reference (each attempt its own). */
  byReference(reference: string) {
    return [...this.intentions.values()].filter((i) => i.reference === reference);
  }

  handler = async (url: URL, init: RequestInit): Promise<Response> => {
    const path = url.pathname;
    const method = (init.method ?? "GET").toUpperCase();
    const auth = new Headers(init.headers).get("authorization") ?? "";
    const body = init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};

    const queued = this.faults.findIndex((f) => !f.path || path.startsWith(f.path));
    let fault: Fault | undefined = queued >= 0 ? this.faults.splice(queued, 1)[0]!.fault : undefined;
    if (!fault && this.randomFaultRate && this.random() < this.randomFaultRate) {
      const pool: Fault[] = method === "GET" ? ["500", "503", "429", "timeout"] : ["500", "503", "429", "timeout", "lost"];
      fault = pool[Math.floor(this.random() * pool.length)];
    }
    if (fault === "500") return json(500, { detail: "Internal server error" });
    if (fault === "503") return new Response("<html>Service Unavailable</html>", { status: 503, headers: { "content-type": "text/html" } });
    if (fault === "429") return json(429, { detail: "Request was throttled." }, { "retry-after": "2" });
    if (fault === "timeout") return hang(init);

    let res: Response;
    if (method === "POST" && path === "/api/auth/tokens") {
      if (body.api_key !== this.apiKey) return json(403, { detail: "Incorrect authentication credentials." });
      const token = `tok_${++this.seq}`;
      this.tokens.set(token, this.clock.now() + 60 * 60_000);
      res = json(201, { token, profile: { id: 302852 } });
    } else if (method === "POST" && path === "/v1/intention/") {
      if (auth !== `Token ${this.secretKey}`) return json(401, { detail: "Authentication credentials were not provided." });
      res = this.createIntention(body);
    } else if (method === "POST" && path === "/api/ecommerce/orders/transaction_inquiry") {
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      const until = this.tokens.get(token);
      if (!until || until <= this.clock.now()) return json(401, { detail: "Invalid token." });
      // Like Paymob: only the order's most recent transaction.
      const latest = [...this.transactions.values()].filter((t) => (t.order as { merchant_order_id: string }).merchant_order_id === body.merchant_order_id).at(-1);
      res = latest ? json(200, latest) : json(404, { detail: "Not found." });
    } else if (method === "GET" && /^\/api\/acceptance\/transactions\/\d+$/.test(path)) {
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      const until = this.tokens.get(token);
      if (!until || until <= this.clock.now()) return json(401, { detail: "Invalid token." });
      const t = this.transactions.get(path.split("/").pop()!);
      res = t ? json(200, t) : json(404, { detail: "Not found." });
    } else {
      res = json(404, { detail: "Not found." });
    }
    if (fault === "lost") return hang(init); // carried out, the answer never comes
    return res;
  };

  // ───────────── E14-2b: payments, the dashboard, callbacks ─────────────

  readonly hmacSecret = "hmac_fake";
  private txnSeq = 192036465;

  /** The customer pays (or not) on the checkout page: a transaction, and the callback Paymob would POST. */
  pay(intentionId: string, opts: { method?: "card" | "wallet" | "kiosk" | "valu"; outcome?: "success" | "declined" | "pending"; auth?: boolean } = {}) {
    const it = this.intentions.get(intentionId)!;
    const method = opts.method ?? "card";
    const outcome = opts.outcome ?? "success";
    const t = this.transaction({
      amount_cents: it.amount, currency: it.currency, order: { id: it.orderId, merchant_order_id: it.reference },
      success: outcome === "success", pending: outcome === "pending", is_auth: Boolean(opts.auth), is_capture: false,
      source_data: method === "card" ? { pan: "2346", type: "card", sub_type: "MasterCard" } : method === "wallet" ? { pan: "01010101010", type: "wallet", sub_type: "wallet" } : method === "kiosk" ? { pan: null, type: "aggregator", sub_type: "AGGREGATOR" } : { pan: null, type: "valu", sub_type: "valu" },
      ...(method === "kiosk" ? { data: { bill_reference: 7134651, message: "Pending" } } : {}),
    });
    return { transactionId: String(t.id), callback: this.callback(t) };
  }

  /** A kiosk reference paid in cash: the same transaction, now a success. */
  complete(transactionId: string) {
    const t = this.transactions.get(transactionId)!;
    Object.assign(t, { pending: false, success: true });
    return this.callback(t);
  }

  /** Done in the Paymob dashboard (or by Mizan in E14-2d): a child transaction; the parent's totals move. */
  refund(transactionId: string, amount: number) {
    const parent = this.transactions.get(transactionId)!;
    parent.refunded_amount_cents = Number(parent.refunded_amount_cents) + amount;
    parent.is_refunded = true;
    return this.callback(this.child(parent, amount, { is_refunded: true }));
  }
  void(transactionId: string) {
    const parent = this.transactions.get(transactionId)!;
    parent.is_voided = true;
    return this.callback(this.child(parent, Number(parent.amount_cents), { is_voided: true }));
  }
  capture(transactionId: string, amount: number) {
    const parent = this.transactions.get(transactionId)!;
    parent.captured_amount = Number(parent.captured_amount) + amount;
    parent.is_captured = true;
    return this.callback(this.child(parent, amount, { is_capture: true }));
  }

  /** A saved card's callback (verified, dropped by Mizan). */
  tokenCallback() {
    const obj = { card_subtype: "MasterCard", created_at: "2024-06-13T11:33:44.592345", email: "mona@example.com", id: 99, masked_pan: "xxxx-2346", merchant_id: 302852, order_id: 1, token: "tok_card" };
    const msg = ["card_subtype", "created_at", "email", "id", "masked_pan", "merchant_id", "order_id", "token"].map((k) => String((obj as Record<string, unknown>)[k])).join("");
    return { query: { hmac: createHmac("sha512", this.hmacSecret).update(msg).digest("hex") }, body: { type: "TOKEN", obj } };
  }

  private transaction(over: Record<string, unknown>): Record<string, unknown> {
    const id = ++this.txnSeq;
    const t: Record<string, unknown> = {
      id, pending: false, amount_cents: 0, success: false, is_auth: false, is_capture: false, is_standalone_payment: true, is_voided: false, is_refunded: false, is_3d_secure: true,
      integration_id: this.integrations.card, profile_id: 302852, has_parent_transaction: false, order: { id: 0, merchant_order_id: "" }, created_at: new Date(this.clock.now()).toISOString().replace("Z", ""),
      currency: "EGP", source_data: { pan: "2346", type: "card", sub_type: "MasterCard" }, error_occured: false, refunded_amount_cents: 0, captured_amount: 0, owner: 302852, parent_transaction: null,
      ...over,
    };
    this.transactions.set(String(id), t);
    return t;
  }

  private child(parent: Record<string, unknown>, amount: number, flags: Record<string, unknown>) {
    return this.transaction({ ...flags, amount_cents: amount, currency: parent.currency, order: parent.order, success: true, has_parent_transaction: true, parent_transaction: parent.id, source_data: parent.source_data, is_standalone_payment: false });
  }

  /** Signed like Paymob: HMAC-SHA512 over the 20 values in their order; `hmac` in the query string. */
  callback(t: Record<string, unknown>) {
    const at = (path: string) => path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), t);
    const msg = ["amount_cents", "created_at", "currency", "error_occured", "has_parent_transaction", "id", "integration_id", "is_3d_secure", "is_auth", "is_capture", "is_refunded", "is_standalone_payment", "is_voided", "order.id", "owner", "pending", "source_data.pan", "source_data.sub_type", "source_data.type", "success"]
      .map((f) => { const v = at(f); return v === null || v === undefined ? "" : String(v); }).join("");
    return { query: { hmac: createHmac("sha512", this.hmacSecret).update(msg).digest("hex") }, body: { type: "TRANSACTION", obj: structuredClone(t), issuer_bank: null, transaction_processed_callback_responses: [] } };
  }

  private createIntention(b: Record<string, unknown>): Response {
    const amount = b.amount;
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) return json(400, { amount: ["A valid integer is required."] });
    const methods = (b.payment_methods ?? []) as unknown[];
    const known = new Set<unknown>(Object.values(this.integrations));
    if (!methods.length || methods.some((m) => !known.has(m))) return json(404, { detail: "Integration ID/Name does not exist" });
    const billing = b.billing_data as Record<string, unknown> | undefined;
    if (billing && !billing.phone_number) return json(400, { billing_data: { phone_number: ["This field is required."] } });
    const items = (b.items ?? []) as Array<Record<string, unknown>>;
    if (items.some((i) => !i.name || typeof i.amount !== "number")) return json(400, { items: ["Each item needs a name and an amount."] });
    const id = `pi_test_${++this.seq}`;
    const orderId = 217503754 + this.seq;
    const intention: FakeIntention = {
      id, orderId, clientSecret: `egy_csk_test_${this.seq}${"x".repeat(20)}`, amount, currency: String(b.currency), reference: String(b.special_reference ?? ""),
      methods: methods as number[], body: b,
    };
    this.intentions.set(id, intention);
    this.creates++;
    return json(201, {
      id, client_secret: intention.clientSecret, ...(this.legacyShape ? {} : { intention_order_id: orderId }),
      payment_keys: methods.map((m) => ({ integration: m, key: `key_${this.seq}`, order_id: orderId, redirection_url: "https://accept.paymob.com/api/acceptance/iframes" })),
      payment_methods: methods.map((m) => ({ integration_id: m, name: null, method_type: "online", currency: b.currency, live: false })),
      special_reference: b.special_reference ?? null, extras: { creation_extras: b.extras ?? {} }, confirmed: false, status: "intended", created: new Date(this.clock.now()).toISOString(),
      amount, currency: b.currency, items: b.items,
    });
  }
}

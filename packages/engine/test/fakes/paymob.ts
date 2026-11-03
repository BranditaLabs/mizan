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

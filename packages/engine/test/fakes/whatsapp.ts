import { signMeta } from "../../src/connectors/whatsapp/webhooks.js";
import { hang, json, type FakeClock } from "./clock.js";

/**
 * In-memory WhatsApp Cloud API (Meta Graph), with the quirks the connector must survive:
 * - errors are HTTP 400 with a body code (130429 throughput, 131056 same customer too often, 132001
 *   template missing), 401 code 190 for a bad token, 5xx with code 1/2/131000;
 * - a free-form message outside the 24-hour window is *accepted*, then fails by webhook (131047);
 * - hangs before processing, and "accepted, then the response is lost";
 * - webhooks signed with the app secret, batched, duplicated and out of order, statuses that can
 *   arrive before the send's response; an alternative shape (ms timestamps, nested error codes,
 *   a send response without `contacts`);
 * - templates listed in small pages with cursors.
 */
type Fault = "500" | "429" | "timeout" | "network" | "lost";
export type WaShape = "standard" | "alt";

export interface FakeWaMessage { id: string; to: string; key: string | undefined; type: string; body: Record<string, any>; at: number }

export class FakeWhatsApp {
  readonly host = "fake-graph.test";
  readonly token = "EAAG-test-token-for-mizan";
  /** Signs webhooks; tests may set it to the app's configured secret. */
  appSecret = "meta-app-secret";
  readonly phoneNumberId = "1098765432";
  readonly wabaId = "2034567890";
  readonly version = "v24.0";
  /** Every message Meta accepted (what the customer receives). */
  readonly accepted: FakeWaMessage[] = [];
  readonly calls: Array<{ method: string; path: string }> = [];
  faults: Array<{ path?: string; fault: Fault }> = [];
  randomFaultRate = 0;
  shape: WaShape = "standard";
  /** Enforce one message per customer per 6 s (Meta's pair rate limit). */
  pairLimit = false;
  /** Probability that a webhook delivery is sent twice; batches are shuffled when > 0. */
  duplicateRate = 0;
  shuffle = false;
  templates: Array<{ name: string; language: string; status: string; category: string }> = [
    { name: "mizan_order_confirm_ar", language: "ar", status: "APPROVED", category: "UTILITY" },
    { name: "mizan_order_confirm_en", language: "en", status: "APPROVED", category: "UTILITY" },
    { name: "mizan_order_confirm_promo", language: "ar", status: "REJECTED", category: "MARKETING" },
    { name: "old_template", language: "en", status: "PAUSED", category: "UTILITY" },
    { name: "pending_one", language: "ar", status: "PENDING", category: "UTILITY" },
  ];
  /** Numbers not on WhatsApp: Meta accepts the send, then fails it by webhook (131026). */
  readonly undeliverable = new Set<string>();
  /** Last time each customer wrote to the business: opens the 24-hour window. */
  private readonly lastInbound = new Map<string, number>();
  private readonly lastSentTo = new Map<string, number>();
  private pending: string[] = [];
  private seq = 0;

  constructor(private readonly clock: FakeClock, private readonly random: () => number = Math.random) {}

  get baseUrl() { return `https://${this.host}`; }

  private err(status: number, code: number, type = "OAuthException", extra: Record<string, unknown> = {}) {
    return json(status, { error: { message: `(#${code}) fake error`, type, code, fbtrace_id: "AbC123", ...extra } });
  }

  private value(extra: Record<string, unknown>) {
    return { object: "whatsapp_business_account", entry: [{ id: this.wabaId, changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "201000000000", phone_number_id: this.phoneNumberId }, ...extra } }] }] };
  }

  private ts() { return this.shape === "alt" ? this.clock.now() : String(Math.floor(this.clock.now() / 1000)); }

  private status(m: FakeWaMessage, status: string, errorCode?: number) {
    const s: Record<string, unknown> = { id: m.id, status, timestamp: this.ts(), recipient_id: m.to, ...(m.key ? { biz_opaque_callback_data: m.key } : {}) };
    if (errorCode) s.errors = [this.shape === "alt" ? { error_data: { code: errorCode }, title: "failed" } : { code: errorCode, title: "failed" }];
    this.pending.push(JSON.stringify(this.value({ statuses: [s] })));
  }

  /** The customer taps a template's quick reply (type "button"). */
  tapQuickReply(from: string, payload: string, context?: string) {
    return this.inbound(from, { type: "button", button: { payload, text: "أكّد" }, ...(context ? { context: { from: "201000000000", id: context } } : {}) });
  }
  /** The customer taps an interactive reply button or list row. */
  tapReply(from: string, id: string, kind: "button_reply" | "list_reply" = "button_reply", context?: string) {
    return this.inbound(from, { type: "interactive", interactive: { type: kind, [kind]: { id, title: "ضيفها" } }, ...(context ? { context: { from: "201000000000", id: context } } : {}) });
  }
  writes(from: string, text: string) { return this.inbound(from, { type: "text", text: { body: text } }); }
  sharesLocation(from: string, latitude: number, longitude: number) { return this.inbound(from, { type: "location", location: { latitude, longitude } }); }

  private inbound(from: string, msg: Record<string, unknown>) {
    const id = `wamid.IN${++this.seq}`;
    this.lastInbound.set(from, this.clock.now());
    this.pending.push(JSON.stringify(this.value({ contacts: [{ profile: { name: "Mona" }, wa_id: from }], messages: [{ from, id, timestamp: this.ts(), ...msg }] })));
    return id;
  }

  /** Webhook deliveries waiting to be POSTed to Mizan: signed, maybe duplicated, maybe out of order. */
  takeWebhooks(): Array<{ body: string; signature: string }> {
    const out: string[] = [];
    for (const b of this.pending) {
      out.push(b);
      if (this.duplicateRate && this.random() < this.duplicateRate) out.push(b);
    }
    this.pending = [];
    if (this.shuffle) for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(this.random() * (i + 1)); [out[i], out[j]] = [out[j]!, out[i]!]; }
    return out.map((body) => ({ body, signature: signMeta(body, this.appSecret) }));
  }

  /** Meta's delivery receipts for everything accepted so far that is still `sent`. */
  deliverAll() { for (const m of this.accepted) if (!(m as { done?: boolean }).done) { (m as { done?: boolean }).done = true; this.status(m, "delivered"); } }

  sentWithKey(key: string) { return this.accepted.filter((m) => m.key === key); }

  handler = async (url: URL, init: RequestInit): Promise<Response> => {
    const method = String(init.method ?? "GET");
    const path = url.pathname.replace(new RegExp(`^/${this.version}/`), "");
    const auth = (init.headers as Record<string, string>)?.authorization;
    if (auth !== `Bearer ${this.token}`) return this.err(401, 190);

    const fi = this.faults.findIndex((f) => !f.path || path.startsWith(f.path));
    let fault: Fault | undefined = fi >= 0 ? this.faults.splice(fi, 1)[0]!.fault : undefined;
    if (!fault && this.randomFaultRate && this.random() < this.randomFaultRate) fault = (["500", "429", "timeout", "network", "lost"] as Fault[])[Math.floor(this.random() * 5)];
    if (fault === "500") return this.err(500, 131000, "OAuthException");
    if (fault === "429") return this.err(400, 130429, "OAuthException", { error_data: { messaging_product: "whatsapp", details: "Rate limit hit" } });
    if (fault === "network") throw new TypeError("fetch failed: socket hang up");
    if (fault === "timeout") return hang(init);
    this.calls.push({ method, path });

    if (method === "GET" && path === `${this.wabaId}/message_templates`) {
      const at = Number(url.searchParams.get("after") ?? 0);
      const page = this.templates.slice(at, at + 2); // Meta pages; small pages exercise the cursor
      const next = at + 2 < this.templates.length;
      return json(200, { data: page, paging: { cursors: { before: String(at), after: String(at + 2) }, ...(next ? { next: `${this.baseUrl}/next` } : {}) } });
    }

    if (method === "POST" && path === `${this.phoneNumberId}/messages`) {
      const body = JSON.parse(String(init.body ?? "{}"));
      if (body.messaging_product !== "whatsapp" || !/^\d{8,15}$/.test(body.to ?? "")) return this.err(400, 100);
      const to: string = body.to;
      if (this.pairLimit && this.clock.now() - (this.lastSentTo.get(to) ?? -Infinity) < 6_000) return this.err(400, 131056);
      if (body.type === "template") {
        const t = this.templates.find((x) => x.name === body.template?.name && x.language === body.template?.language?.code);
        if (!t || t.status !== "APPROVED") return this.err(404, 132001);
      } else if (body.type === "interactive") {
        const it = body.interactive;
        const buttons = it?.action?.buttons ?? [];
        if (it?.type === "button" && (buttons.length < 1 || buttons.length > 3 || buttons.some((b: any) => [...(b.reply?.title ?? "")].length > 20))) return this.err(400, 131009);
      } else if (body.type !== "text") return this.err(400, 131051);
      const m: FakeWaMessage = { id: `wamid.OUT${++this.seq}`, to, key: body.biz_opaque_callback_data, type: body.type, body, at: this.clock.now() };
      this.accepted.push(m);
      this.lastSentTo.set(to, this.clock.now());
      // Free-form outside the window: accepted now, failed by webhook (Meta behaviour).
      const windowOpen = this.clock.now() - (this.lastInbound.get(to) ?? -Infinity) < 24 * 3_600_000;
      if (this.undeliverable.has(to)) this.status(m, "failed", 131026);
      else if (body.type !== "template" && !windowOpen) this.status(m, "failed", 131047);
      else this.status(m, "sent");
      if (fault === "lost") return hang(init); // accepted; the caller never hears back
      return json(200, { messaging_product: "whatsapp", ...(this.shape === "alt" ? {} : { contacts: [{ input: to, wa_id: to }] }), messages: [{ id: m.id, ...(body.type === "template" ? { message_status: "accepted" } : {}) }] });
    }
    return this.err(400, 100, "GraphMethodException");
  };
}

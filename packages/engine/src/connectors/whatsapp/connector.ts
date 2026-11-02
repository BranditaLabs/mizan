import { IntegrationError } from "../../core/errors.js";
import type { Runtime } from "../../core/runtime.js";
import type { DriftSink } from "../../adapt/drift.js";
import { Resolver } from "../../adapt/resolve.js";
import { CircuitBreaker } from "../../resilience/circuit.js";
import { send, type HttpResponse } from "../../resilience/http.js";
import { AdaptiveBucket } from "../../resilience/limiter.js";
import { maskNumber, type MessagingChannel, type MessagingProvider, type Sms, type VoiceCall, type WhatsAppTemplate } from "../messaging/provider.js";
import { classifyGraphError } from "./errors.js";

export interface WhatsAppCloudConfig {
  /** The merchant's sending number in Meta (not the phone number itself). */
  phoneNumberId: string;
  /** WhatsApp Business Account id: templates live here. */
  wabaId: string;
  /** Business token (Embedded Signup) or system-user token; kept by the secrets service. */
  accessToken: string;
  /** Graph API version, pinned; review quarterly like Shopify's. */
  graphVersion?: string;
  baseUrl?: string;
}

export const WHATSAPP_GRAPH_VERSION = "v24.0";

/** Meta's limits on interactive messages; checked before sending so a bad message never costs a call. */
export const LIMITS = { buttons: 3, buttonTitle: 20, buttonId: 256, rows: 10, rowTitle: 24, rowDescription: 72, listButton: 20, body: 1024, text: 4096, callbackData: 512 } as const;

export interface SendResult {
  /** Meta's message id (`wamid.…`): status webhooks and replies (`context.id`) refer to it. */
  ref: string;
  /** The WhatsApp id Meta resolved the number to; can differ from what was sent (country quirks). */
  waId?: string;
}

interface Common {
  /** E.164; sent as digits. */
  to: string;
  /**
   * Our key for this send (e.g. the confirmation step id). Meta has no idempotency key; it echoes
   * this in every status webhook as `biz_opaque_callback_data`, which is how a send whose response
   * was lost is verified before anything is sent again (CLAUDE.md rule 5, `afterUnknownSend`).
   */
  key: string;
}
export interface TemplateMessage extends Common { template: string; lang: string; params: string[]; quickReplies: string[] }
export interface ButtonsMessage extends Common { body: string; buttons: Array<{ id: string; title: string }>; footer?: string }
export interface ListMessage extends Common { body: string; button: string; rows: Array<{ id: string; title: string; description?: string }>; section?: string }
export interface TextMessage extends Common { text: string }

export interface TemplateInfo { name: string; language: string; status: string; category?: string }

/** The conversation side of WhatsApp: templates to open it, then buttons, lists and text inside the 24-hour window. */
export interface WhatsAppChat {
  sendTemplate(m: TemplateMessage): Promise<SendResult>;
  sendButtons(m: ButtonsMessage): Promise<SendResult>;
  sendList(m: ListMessage): Promise<SendResult>;
  sendText(m: TextMessage): Promise<SendResult>;
  templates(names?: string[]): Promise<TemplateInfo[]>;
}

/**
 * WhatsApp Cloud API (Meta), E6-4: one merchant number per connection.
 *
 * - Every call goes through `send()` with a circuit breaker and a bucket per number. Meta allows
 *   ~80 messages/s per number by default and one message every ~6 s to the same customer (131056).
 * - Sends are not idempotent: a timeout is never re-sent here. The caller keeps the step pending
 *   and waits for a status webhook carrying its key; only when none comes is it sent again.
 * - Inbound (replies, statuses) arrives by webhook only: `whatsapp/webhooks.ts`.
 * - Numbers are masked in logs; message text never is logged.
 */
export class WhatsAppCloudConnector implements MessagingProvider, WhatsAppChat {
  readonly id = "whatsapp";
  readonly name = "whatsapp_cloud";
  readonly channels: ReadonlySet<MessagingChannel> = new Set(["whatsapp"]);
  readonly circuit: CircuitBreaker;
  readonly bucket: AdaptiveBucket;

  constructor(private readonly cfg: WhatsAppCloudConfig, private readonly rt: Runtime, private readonly drift: DriftSink) {
    this.circuit = new CircuitBreaker(`whatsapp:${cfg.phoneNumberId}`, rt.clock, { failureThreshold: 5, openMs: 30_000 });
    this.bucket = new AdaptiveBucket(rt.clock, { capacity: 20, refillPerSec: 20 });
  }

  private get base() {
    return `${(this.cfg.baseUrl ?? "https://graph.facebook.com").replace(/\/+$/, "")}/${this.cfg.graphVersion ?? WHATSAPP_GRAPH_VERSION}`;
  }

  private request(op: string, method: "GET" | "POST", path: string, body?: unknown, idempotent = method === "GET"): Promise<HttpResponse> {
    return send(this.rt, {
      connector: "whatsapp", op: `whatsapp.${op}`, method, url: `${this.base}/${path}`, body, idempotent,
      headers: { authorization: `Bearer ${this.cfg.accessToken}` },
      timeoutMs: 10_000, maxAttempts: idempotent ? 5 : 3,
      classify: (res) => classifyGraphError(`whatsapp.${op}`, res, this.rt.clock.now()),
      inspect: (res) => (res.json && typeof res.json === "object" ? null
        : new IntegrationError({ kind: "transient", connector: "whatsapp", message: `whatsapp.${op}: empty or non-JSON response`, status: res.status })),
    }, { circuit: this.circuit, bucket: this.bucket });
  }

  private async message(op: string, m: Common, payload: Record<string, unknown>): Promise<SendResult> {
    if (m.key.length > LIMITS.callbackData) throw this.invalid(op, "key longer than 512");
    const to = m.to.replace(/\D/g, "");
    if (to.length < 8) throw this.invalid(op, `number ${maskNumber(m.to)} is not a full international number`);
    const res = await this.request(op, "POST", `${this.cfg.phoneNumberId}/messages`, {
      messaging_product: "whatsapp", recipient_type: "individual", to, biz_opaque_callback_data: m.key, ...payload,
    });
    const r = new Resolver(res.json, { connector: "whatsapp", entity: "message", drift: this.drift, now: () => this.rt.clock.now() });
    const ref = r.str("ref", ["messages.0.id", "message_id", "id"], { required: true })!;
    const waId = r.str("waId", ["contacts.0.wa_id", "contacts.0.input"]);
    this.rt.logger.log("info", "whatsapp.sent", { op, to: maskNumber(m.to), ref });
    return waId ? { ref, waId } : { ref };
  }

  private invalid(op: string, why: string) {
    return new IntegrationError({ kind: "validation", connector: "whatsapp", message: `whatsapp.${op}: ${why}` });
  }

  private within(op: string, label: string, v: string, max: number) {
    if (!v.trim()) throw this.invalid(op, `${label} is empty`);
    if ([...v].length > max) throw this.invalid(op, `${label} longer than ${max}`);
  }

  /** An approved template (opens the conversation outside the 24-hour window), with quick-reply payloads in button order. */
  async sendTemplate(m: TemplateMessage): Promise<SendResult> {
    m.quickReplies.forEach((p) => this.within("sendTemplate", "quick reply payload", p, LIMITS.buttonId));
    const components: unknown[] = [];
    if (m.params.length) components.push({ type: "body", parameters: m.params.map((text) => ({ type: "text", text })) });
    m.quickReplies.forEach((payload, i) => components.push({ type: "button", sub_type: "quick_reply", index: String(i), parameters: [{ type: "payload", payload }] }));
    return this.message("sendTemplate", m, { type: "template", template: { name: m.template, language: { code: m.lang }, components } });
  }

  /** Up to 3 reply buttons; only inside the 24-hour window. */
  async sendButtons(m: ButtonsMessage): Promise<SendResult> {
    const op = "sendButtons";
    this.within(op, "body", m.body, LIMITS.body);
    if (!m.buttons.length || m.buttons.length > LIMITS.buttons) throw this.invalid(op, `1–${LIMITS.buttons} buttons`);
    for (const b of m.buttons) { this.within(op, "button title", b.title, LIMITS.buttonTitle); this.within(op, "button id", b.id, LIMITS.buttonId); }
    return this.message(op, m, {
      type: "interactive",
      interactive: {
        type: "button", body: { text: m.body }, ...(m.footer ? { footer: { text: m.footer } } : {}),
        action: { buttons: m.buttons.map((b) => ({ type: "reply", reply: { id: b.id, title: b.title } })) },
      },
    });
  }

  /** A list (up to 10 rows behind one button); only inside the 24-hour window. */
  async sendList(m: ListMessage): Promise<SendResult> {
    const op = "sendList";
    this.within(op, "body", m.body, LIMITS.body);
    this.within(op, "list button", m.button, LIMITS.listButton);
    if (!m.rows.length || m.rows.length > LIMITS.rows) throw this.invalid(op, `1–${LIMITS.rows} rows`);
    for (const r of m.rows) {
      this.within(op, "row title", r.title, LIMITS.rowTitle);
      this.within(op, "row id", r.id, LIMITS.buttonId);
      if (r.description) this.within(op, "row description", r.description, LIMITS.rowDescription);
    }
    return this.message(op, m, {
      type: "interactive",
      interactive: {
        type: "list", body: { text: m.body },
        action: { button: m.button, sections: [{ ...(m.section ? { title: m.section } : {}), rows: m.rows.map((r) => ({ id: r.id, title: r.title, ...(r.description ? { description: r.description } : {}) })) }] },
      },
    });
  }

  async sendText(m: TextMessage): Promise<SendResult> {
    this.within("sendText", "text", m.text, LIMITS.text);
    return this.message("sendText", m, { type: "text", text: { body: m.text, preview_url: false } });
  }

  /** Templates of the business account and their review status (APPROVED, PENDING, REJECTED, PAUSED, DISABLED). */
  async templates(names?: string[]): Promise<TemplateInfo[]> {
    const out: TemplateInfo[] = [];
    let after: string | undefined;
    for (let page = 0; page < 20; page++) {
      const q = new URLSearchParams({ fields: "name,status,language,category", limit: "100", ...(after ? { after } : {}) });
      const res = await this.request("templates", "GET", `${this.cfg.wabaId}/message_templates?${q}`);
      const r = new Resolver(res.json, { connector: "whatsapp", entity: "templates", drift: this.drift, now: () => this.rt.clock.now() });
      for (const t of r.arr("data", ["data"])) {
        const tr = r.child(t, "template");
        const info: TemplateInfo = {
          name: tr.str("name", ["name"], { required: true })!,
          language: tr.str("language", ["language", "language.code"]) ?? "",
          status: (tr.str("status", ["status"], { required: true }) ?? "").toUpperCase(),
        };
        const category = tr.str("category", ["category"]);
        if (category) info.category = category.toUpperCase();
        if (!names || names.includes(info.name)) out.push(info);
      }
      after = r.str("after", ["paging.cursors.after"]);
      if (!after || !r.str("next", ["paging.next"])) break;
    }
    return out;
  }

  // MessagingProvider (E6-7 flow): the template with quick replies.
  sendWhatsApp(m: WhatsAppTemplate) {
    return this.sendTemplate({ to: m.to, key: m.key ?? m.buttons.join("|").slice(0, LIMITS.callbackData), template: m.template, lang: m.lang, params: m.params, quickReplies: m.buttons });
  }
  sendSms(_m: Sms): Promise<{ ref: string }> { return Promise.reject(this.invalid("sendSms", "WhatsApp cannot send SMS")); }
  placeCall(_c: VoiceCall): Promise<{ ref: string }> { return Promise.reject(this.invalid("placeCall", "WhatsApp calls are not supported")); }
}

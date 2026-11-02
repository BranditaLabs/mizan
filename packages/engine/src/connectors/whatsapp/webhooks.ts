import { createHmac, timingSafeEqual } from "node:crypto";
import type { DriftSink } from "../../adapt/drift.js";
import { Resolver } from "../../adapt/resolve.js";

/**
 * WhatsApp Cloud API webhooks (Meta), E6-4.
 * - Subscribe: Meta calls GET with `hub.mode=subscribe`, `hub.verify_token`, `hub.challenge`;
 *   echo the challenge only when the token is ours.
 * - Deliveries: POST signed with `X-Hub-Signature-256: sha256=<hex HMAC-SHA256(app secret, raw body)>`.
 *   Verify before parsing. Meta retries for days on non-200 and can deliver duplicates and out of
 *   order (a `read` before its `delivered`, a status before our send returned): dedupe by message
 *   id + status, never assume order. Respond 200 fast; real work happens in a job.
 */
export function verifyMetaSignature(rawBody: string | Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const given = Buffer.from(header.slice(7), "hex");
  const digest = createHmac("sha256", appSecret).update(rawBody).digest();
  return given.length === digest.length && timingSafeEqual(given, digest);
}

export function signMeta(rawBody: string, appSecret: string): string {
  return `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
}

/** GET subscription check: the challenge to echo, or null to refuse (403). */
export function verifyChallenge(query: Record<string, unknown>, verifyToken: string): string | null {
  const token = query["hub.verify_token"];
  if (query["hub.mode"] !== "subscribe" || typeof token !== "string" || typeof query["hub.challenge"] !== "string") return null;
  const a = Buffer.from(token);
  const b = Buffer.from(verifyToken);
  return a.length === b.length && timingSafeEqual(a, b) ? (query["hub.challenge"] as string) : null;
}

export type InboundKind = "quick_reply" | "button_reply" | "list_reply" | "text" | "location" | "other";

/** A customer's message. `reply` is the id we put on the button or row (or a template's quick-reply payload). */
export interface InboundMessage {
  id: string;
  /** Sender's WhatsApp id (digits). */
  from: string;
  phoneNumberId: string;
  at: number;
  kind: InboundKind;
  reply?: string;
  /** Button or row title as the customer saw it; free text for `text`. Personal data: never log it. */
  text?: string;
  /** The message this one answers (our `wamid`), when Meta says. */
  contextId?: string;
  location?: { lat: number; lng: number };
}

export type DeliveryStatus = "sent" | "delivered" | "read" | "failed" | "unknown";

export interface StatusUpdate {
  /** Our message's `wamid`. */
  id: string;
  status: DeliveryStatus;
  /** Meta's raw status, kept when it is one Mizan does not know yet. */
  raw: string;
  at: number;
  recipient: string;
  phoneNumberId: string;
  /** Our send key, echoed as biz_opaque_callback_data. */
  key?: string;
  /** Meta error code on `failed` (e.g. 131047 window closed, 131026 undeliverable). */
  errorCode?: number;
}

export interface ParsedWebhook { messages: InboundMessage[]; statuses: StatusUpdate[] }

const KNOWN_STATUS = new Set<DeliveryStatus>(["sent", "delivered", "read", "failed"]);

/** Seconds (Meta) or milliseconds or ISO → milliseconds. */
function toMs(v: string | number | undefined, fallback: number): number {
  if (v === undefined) return fallback;
  const n = Number(v);
  if (Number.isFinite(n)) return n < 1e12 ? n * 1000 : n;
  const d = Date.parse(String(v));
  return Number.isFinite(d) ? d : fallback;
}

/** Every message and status in one delivery (Meta batches several per POST, across entries and changes). */
export function parseWhatsAppWebhook(body: unknown, drift: DriftSink, now: () => number): ParsedWebhook {
  const r = new Resolver(body, { connector: "whatsapp", entity: "webhook", drift, now });
  const out: ParsedWebhook = { messages: [], statuses: [] };
  for (const entry of r.arr("entry", ["entry"])) {
    const er = r.child(entry, "webhook.entry");
    for (const change of er.arr("changes", ["changes"])) {
      const cr = er.child(change, "webhook.change");
      if ((cr.str("field", ["field"]) ?? "messages") !== "messages") continue;
      const value = cr.any("value", ["value"]);
      if (!value) continue;
      const vr = cr.child(value, "webhook.value");
      const phoneNumberId = vr.str("phoneNumberId", ["metadata.phone_number_id", "phone_number_id"]) ?? "";

      for (const m of vr.arr("messages", ["messages"])) {
        const mr = vr.child(m, "whatsapp.message");
        const type = mr.str("type", ["type"]) ?? "";
        const msg: InboundMessage = {
          id: mr.str("id", ["id"], { required: true })!,
          from: (mr.str("from", ["from", "wa_id"], { required: true }) ?? "").replace(/\D/g, ""),
          phoneNumberId, at: toMs(mr.str("timestamp", ["timestamp"]), now()), kind: "other",
        };
        const contextId = mr.str("contextId", ["context.id"]);
        if (contextId) msg.contextId = contextId;
        if (type === "button") {
          // A template's quick reply.
          msg.kind = "quick_reply";
          const reply = mr.str("reply", ["button.payload", "button.text"]);
          const text = mr.str("title", ["button.text"]);
          if (reply) msg.reply = reply;
          if (text) msg.text = text;
        } else if (type === "interactive") {
          const it = mr.str("interactiveType", ["interactive.type"]);
          msg.kind = it === "list_reply" ? "list_reply" : "button_reply";
          const reply = mr.str("reply", it === "list_reply" ? ["interactive.list_reply.id"] : ["interactive.button_reply.id", "interactive.list_reply.id"]);
          const text = mr.str("title", ["interactive.button_reply.title", "interactive.list_reply.title"]);
          if (reply) msg.reply = reply;
          if (text) msg.text = text;
        } else if (type === "text") {
          msg.kind = "text";
          const text = mr.str("text", ["text.body", "body"]);
          if (text) msg.text = text;
        } else if (type === "location") {
          const lat = mr.num("lat", ["location.latitude"]);
          const lng = mr.num("lng", ["location.longitude"]);
          msg.kind = "location";
          if (lat !== undefined && lng !== undefined) msg.location = { lat, lng };
        }
        out.messages.push(msg);
      }

      for (const s of vr.arr("statuses", ["statuses"])) {
        const sr = vr.child(s, "whatsapp.status");
        const raw = (sr.str("status", ["status"], { required: true }) ?? "").toLowerCase();
        const known = KNOWN_STATUS.has(raw as DeliveryStatus);
        if (!known) drift.record({ connector: "whatsapp", entity: "whatsapp.status", kind: "unknown_status", field: "status", detail: `"${raw}"`, at: now() });
        const st: StatusUpdate = {
          id: sr.str("id", ["id"], { required: true })!,
          status: known ? (raw as DeliveryStatus) : "unknown", raw,
          at: toMs(sr.str("timestamp", ["timestamp"]), now()),
          recipient: (sr.str("recipient", ["recipient_id"]) ?? "").replace(/\D/g, ""),
          phoneNumberId,
        };
        const key = sr.str("key", ["biz_opaque_callback_data"]);
        if (key) st.key = key;
        const code = sr.num("errorCode", ["errors.0.code", "errors.0.error_data.code"]);
        if (code !== undefined) st.errorCode = code;
        out.statuses.push(st);
      }
    }
  }
  return out;
}

/** Status order: a late `delivered` never overwrites `read`; `failed` is final. */
export const STATUS_RANK: Record<DeliveryStatus, number> = { unknown: 0, sent: 1, delivered: 2, read: 3, failed: 4 };

/**
 * A send whose response was lost (timeout): Meta has no idempotency key, so it is verified by
 * waiting for a status webhook carrying its key. Any status means it went out; none after
 * `waitMs` means it never did and is safe to send again.
 */
export function afterUnknownSend(sentAt: number, statusSeen: boolean, now: number, waitMs = 10 * 60_000): "sent" | "wait" | "resend" {
  if (statusSeen) return "sent";
  return now - sentAt < waitMs ? "wait" : "resend";
}

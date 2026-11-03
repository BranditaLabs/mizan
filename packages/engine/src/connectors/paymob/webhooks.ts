import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Paymob callback signatures (E14-2b; docs/06 §7 "Paymob in depth"). The transaction HMAC is
 * HMAC-SHA512, with the account's HMAC secret, over these 20 values joined with nothing, in this
 * order; the signature comes as `?hmac=` in the query string (not a header, not the body).
 * Booleans are written true/false. On the server POST the values come from `obj` (order.id,
 * source_data.*); on the browser GET they are flat query keys (`order` or `order_id`,
 * `source_data.pan` or `source_data_pan`: both seen, confirm per method).
 */
const TRANSACTION_FIELDS = [
  "amount_cents", "created_at", "currency", "error_occured", "has_parent_transaction", "id", "integration_id", "is_3d_secure", "is_auth", "is_capture",
  "is_refunded", "is_standalone_payment", "is_voided", "order.id", "owner", "pending", "source_data.pan", "source_data.sub_type", "source_data.type", "success",
] as const;
/** A saved card (TOKEN callback): verified, acknowledged, never kept (card data never enters Mizan). */
const TOKEN_FIELDS = ["card_subtype", "created_at", "email", "id", "masked_pan", "merchant_id", "order_id", "token"] as const;

const text = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "boolean" ? String(v) : String(v));
function at(obj: Record<string, unknown>, path: string): unknown {
  let cur: unknown = obj;
  for (const k of path.split(".")) cur = cur && typeof cur === "object" ? (cur as Record<string, unknown>)[k] : undefined;
  return cur;
}

/** The signed string of a transaction, from the POST's `obj`. */
export function paymobTransactionString(obj: Record<string, unknown>): string {
  return TRANSACTION_FIELDS.map((f) => text(at(obj, f))).join("");
}

/** The signed string of the browser redirect's flat query (GET). */
export function paymobRedirectString(q: Record<string, string | undefined>): string {
  const pick = (...keys: string[]) => keys.map((k) => q[k]).find((v) => v !== undefined) ?? "";
  return TRANSACTION_FIELDS.map((f) => f === "order.id" ? pick("order", "order_id", "order.id")
    : f.startsWith("source_data.") ? pick(f, f.replace(".", "_")) : pick(f)).join("");
}

export function paymobHmac(message: string, secret: string): string {
  return createHmac("sha512", secret).update(message, "utf8").digest("hex");
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a.toLowerCase(), "utf8");
  const y = Buffer.from(b.toLowerCase(), "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

export type PaymobCallback =
  | { ok: true; type: "TRANSACTION"; transactionId: string; reference: string | null; flagsKey: string }
  | { ok: true; type: "TOKEN" }
  | { ok: false; reason: "signature" | "shape" };

/**
 * A server callback (POST body + query): verified before anything in it is trusted. Returns the
 * transaction to re-read (thin webhook, fat fetch) and a key of its signed flags, so the same
 * callback delivered again dedupes while the same id after a refund, void or capture does not.
 */
export function verifyPaymobCallback(query: Record<string, string | undefined>, body: unknown, secret: string): PaymobCallback {
  const signature = query.hmac;
  if (!signature || !body || typeof body !== "object") return { ok: false, reason: signature ? "shape" : "signature" };
  const b = body as Record<string, unknown>;
  const obj = b.obj && typeof b.obj === "object" ? (b.obj as Record<string, unknown>) : null;
  if (!obj) return { ok: false, reason: "shape" };
  const type = String(b.type ?? "TRANSACTION").toUpperCase();
  if (type === "TOKEN") {
    const msg = TOKEN_FIELDS.map((f) => text(obj[f])).join("");
    return same(paymobHmac(msg, secret), signature) ? { ok: true, type: "TOKEN" } : { ok: false, reason: "signature" };
  }
  if (!same(paymobHmac(paymobTransactionString(obj), secret), signature)) return { ok: false, reason: "signature" };
  const id = text(obj.id);
  if (!/^\d{1,20}$/.test(id)) return { ok: false, reason: "shape" };
  const ref = at(obj, "order.merchant_order_id");
  // Signed fields only: an unsigned one (refunded_amount_cents…) could be changed freely to mint new keys from one valid hmac.
  // A second partial refund leaves the parent's signed flags as they were; its own child callback (a new id) and the sweep carry it.
  const flags = ["success", "pending", "is_voided", "is_refunded", "is_capture", "is_auth", "error_occured", "has_parent_transaction", "amount_cents"].map((f) => text(obj[f])).join("|");
  return { ok: true, type: "TRANSACTION", transactionId: id, reference: typeof ref === "string" && ref ? ref : null, flagsKey: flags };
}

/** The browser redirect (GET): verified, for showing the customer a result page only — never for changing an order. */
export function verifyPaymobRedirect(query: Record<string, string | undefined>, secret: string): boolean {
  return Boolean(query.hmac) && same(paymobHmac(paymobRedirectString(query), secret), query.hmac!);
}

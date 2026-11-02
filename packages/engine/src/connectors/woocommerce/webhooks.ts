import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * WooCommerce webhooks (WC_Webhook, trunk):
 * - Signature: `X-WC-Webhook-Signature` = base64 HMAC-SHA256 of the raw body, keyed with the
 *   webhook's secret (HTML entities in the secret decoded first). Verify before parsing.
 * - The body is the same JSON as the REST API's order; `order.deleted` sends only `{ id }`.
 * - When a webhook is saved, WooCommerce pings the URL with the unsigned form body
 *   `webhook_id=<id>` and refuses to save it unless the answer is 2xx.
 * - No retries: a failed delivery is gone, and after more than 5 failures in a row WooCommerce
 *   disables the webhook. Polling (`modified_after`) catches what was lost, and the webhook sync
 *   turns a disabled webhook back on.
 * - `X-WC-Webhook-Delivery-ID` is a hash of the webhook id and the current second, so it is not
 *   a reliable event id: dedupe on the order id and its `date_modified_gmt`.
 */
export function verifyWooSignature(rawBody: string | Buffer, header: string | undefined, secret: string): boolean {
  if (!header || !secret) return false;
  const digest = createHmac("sha256", decodeEntities(secret)).update(rawBody).digest();
  let given: Buffer;
  try { given = Buffer.from(header, "base64"); } catch { return false; }
  return given.length === digest.length && timingSafeEqual(given, digest);
}

export function signWoo(rawBody: string, secret: string): string {
  return createHmac("sha256", decodeEntities(secret)).update(rawBody).digest("base64");
}

/** The ping WooCommerce sends when a webhook is saved: unsigned, form-encoded. */
export function isWooPing(rawBody: string): boolean {
  return /^webhook_id=\d+$/.test(rawBody.trim());
}

export interface WooWebhookMeta { topic: string; resource: string; event: string; webhookId?: string | undefined; deliveryId?: string | undefined; source?: string | undefined }

export function readWooHeaders(h: Record<string, string | undefined>): WooWebhookMeta {
  const get = (k: string) => h[k] ?? h[k.toLowerCase()];
  return {
    topic: (get("X-WC-Webhook-Topic") ?? "").toLowerCase(),
    resource: (get("X-WC-Webhook-Resource") ?? "").toLowerCase(),
    event: (get("X-WC-Webhook-Event") ?? "").toLowerCase(),
    webhookId: get("X-WC-Webhook-ID"),
    deliveryId: get("X-WC-Webhook-Delivery-ID"),
    source: get("X-WC-Webhook-Source"),
  };
}

/** wp_specialchars_decode(…, ENT_QUOTES): what WordPress does to the secret before signing. */
function decodeEntities(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0*39;/g, "'").replace(/&amp;/g, "&");
}

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Shopify HTTPS webhooks.
 * - Signature: base64 HMAC-SHA256 of the raw body, keyed with the app's
 *   client secret, in `X-Shopify-Hmac-SHA256`. Verify before parsing.
 * - Dedupe: `X-Shopify-Event-Id` is the same across duplicate deliveries of
 *   one event (and across subscriptions); fall back to `X-Shopify-Webhook-Id`.
 * - Respond within 5 seconds: verify, record, enqueue, return 200. All real
 *   work happens in the outbox worker.
 */
export function verifyShopifyHmac(rawBody: string | Buffer, header: string | undefined, secret: string): boolean {
  if (!header) return false;
  const digest = createHmac("sha256", secret).update(rawBody).digest();
  let given: Buffer;
  try {
    given = Buffer.from(header, "base64");
  } catch {
    return false;
  }
  return given.length === digest.length && timingSafeEqual(given, digest);
}

export function signShopify(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("base64");
}

export interface ShopifyWebhookMeta {
  topic: string;
  shop: string;
  eventId?: string;
  webhookId?: string;
  apiVersion?: string;
}

export function readShopifyHeaders(h: Record<string, string | undefined>): ShopifyWebhookMeta {
  const get = (k: string) => h[k] ?? h[k.toLowerCase()];
  return {
    topic: (get("X-Shopify-Topic") ?? "").toLowerCase(),
    shop: get("X-Shopify-Shop-Domain") ?? "",
    eventId: get("X-Shopify-Event-Id"),
    webhookId: get("X-Shopify-Webhook-Id"),
    apiVersion: get("X-Shopify-API-Version"),
  };
}

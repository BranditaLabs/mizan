import { missingScopes } from "@mizan/engine";
import { z } from "zod";

/** A store, courier or other provider connection as the dashboard shows it. */
export const ConnectionViewSchema = z.object({
  id: z.uuid(),
  kind: z.enum(["store", "courier", "whatsapp", "ads", "payment", "tax"]),
  provider: z.string(),
  account: z.string().nullable(),
  status: z.enum(["pending", "active", "needs_attention", "disconnected"]),
  /** Why it needs attention or was disconnected (key_refused, key_lacks_permission, app_uninstalled …). */
  reason: z.string().nullable().describe("key_refused, key_lacks_permission, app_uninstalled, scopes_changed …"),
  /** Permissions Mizan now needs that the store has not approved yet (reason scopes_changed). */
  missingScopes: z.array(z.string()),
  /** When the credentials last passed a check (couriers). */
  verifiedAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
});
export type ConnectionView = z.infer<typeof ConnectionViewSchema>;
export const ConnectionListSchema = z.object({ data: z.array(ConnectionViewSchema) });

export const BostaKeySchema = z.strictObject({
  /** From Bosta's dashboard (Settings → API integration). Stored encrypted; never shown again. */
  apiKey: z.string().trim().min(8).max(512).describe("From Bosta's dashboard (Settings → API integration); stored encrypted, never shown again"),
});

/** E5-7: the store's address and the REST keys the owner creates in WooCommerce (Settings → Advanced → REST API, Read/Write). */
export const WooCommerceKeysSchema = z.strictObject({
  siteUrl: z.string().trim().min(4).max(300).describe("The store's address, https://shop.example.com"),
  consumerKey: z.string().trim().regex(/^ck_[A-Za-z0-9_]{8,}$/, "a WooCommerce consumer key starts with ck_").describe("ck_…; stored encrypted, never shown again"),
  consumerSecret: z.string().trim().regex(/^cs_[A-Za-z0-9_]{8,}$/, "a WooCommerce consumer secret starts with cs_").describe("cs_…; stored encrypted, never shown again"),
});

/** E5-7 one click: the store's address; Mizan answers with WooCommerce's approval page for it. */
export const WooCommerceAuthorizeSchema = z.strictObject({
  siteUrl: z.string().trim().min(4).max(300).describe("The store's address, https://shop.example.com"),
  locale: z.enum(["ar", "en"]).default("ar").describe("Where the owner comes back to after approving"),
});
export const WooCommerceAuthorizeUrlSchema = z.object({
  url: z.url().describe("WooCommerce's approval page (/wc-auth/v1/authorize) for this store"),
  expiresAt: z.iso.datetime().describe("Approve before this; then ask for a new link"),
});

type Row = { id: string; kind: string; provider: string; external_account: string | null; status: string; status_reason: string | null; config: unknown; updated_at: Date };

/**
 * kind and status are TEXT with CHECK constraints (migration 0001): the casts name what the database guarantees.
 * `requiredScopes`: a Shopify store installed before Mizan asked for more (e.g. write_order_edits)
 * shows as needing attention until the owner approves the new permissions in Shopify.
 */
export function toConnectionView(c: Row, requiredScopes: string[] = []): ConnectionView {
  const config = c.config as { verifiedAt?: unknown; scopes?: unknown } | null;
  const verifiedAt = config?.verifiedAt;
  const granted = Array.isArray(config?.scopes) ? config.scopes.filter((x): x is string => typeof x === "string") : null;
  const missing = c.provider === "shopify" && c.status === "active" && granted && requiredScopes.length ? missingScopes(requiredScopes, granted) : [];
  return {
    id: c.id, kind: c.kind as ConnectionView["kind"], provider: c.provider, account: c.external_account,
    status: missing.length ? "needs_attention" : c.status as ConnectionView["status"], reason: missing.length ? "scopes_changed" : c.status_reason,
    missingScopes: missing,
    verifiedAt: typeof verifiedAt === "string" ? verifiedAt : null, updatedAt: c.updated_at.toISOString(),
  };
}

import type { DriftSink } from "../../adapt/drift.js";
import { Resolver } from "../../adapt/resolve.js";

/**
 * Shopify's mandatory compliance (privacy) webhooks, configured once for the app:
 * shopify.dev/docs/apps/build/compliance/privacy-law-compliance
 *
 *   customers/data_request  a customer asked the store for their data
 *   customers/redact        erase a customer's data (sent ≥ 10 days after the request)
 *   shop/redact             erase the shop's data (48 h after uninstall)
 *
 * Mapped to a canonical request with ids only. The customer's email and phone are
 * returned for matching and must not be stored as received.
 */
export type ComplianceTopic = "customers/data_request" | "customers/redact" | "shop/redact";

export interface ComplianceRequest {
  topic: ComplianceTopic;
  shop: string;
  customer?: { id?: string; email?: string; phone?: string };
  /** Order GIDs named by Shopify (orders_to_redact / orders_requested). */
  orderIds: string[];
  /** customers/data_request: Shopify's id for the request. */
  dataRequestId?: string;
}

export const COMPLIANCE_TOPICS: readonly ComplianceTopic[] = ["customers/data_request", "customers/redact", "shop/redact"];

const orderGid = (v: unknown) => {
  const s = String(v);
  return s.startsWith("gid://") ? s : /^\d+$/.test(s) ? `gid://shopify/Order/${s}` : null;
};

/** Null when the topic is not a compliance topic. Throws SchemaDriftError when the shop is missing. */
export function parseComplianceWebhook(topic: string, body: unknown, drift: DriftSink, now: () => number): ComplianceRequest | null {
  const t = topic.toLowerCase() as ComplianceTopic;
  if (!COMPLIANCE_TOPICS.includes(t)) return null;
  const r = new Resolver(body, { connector: "shopify", entity: `compliance:${t}`, drift, now });
  const shop = r.str("shop", ["shop_domain", "shop.domain", "myshopify_domain"], { required: true })!.toLowerCase();
  const list = (field: string, paths: string[]) => {
    const v = r.any(field, paths);
    return Array.isArray(v) ? v.map(orderGid).filter((x): x is string => x !== null) : [];
  };
  const req: ComplianceRequest = {
    topic: t, shop,
    orderIds: t === "customers/redact" ? list("orders", ["orders_to_redact"]) : t === "customers/data_request" ? list("orders", ["orders_requested"]) : [],
  };
  if (t !== "shop/redact") {
    const id = r.any("customer.id", ["customer.id", "customer_id"]);
    req.customer = {
      ...(id != null ? { id: String(id) } : {}),
      ...(r.str("customer.email", ["customer.email"]) ? { email: r.str("customer.email", ["customer.email"])! } : {}),
      ...(r.str("customer.phone", ["customer.phone"]) ? { phone: r.str("customer.phone", ["customer.phone"])! } : {}),
    };
  }
  const dr = r.any("data_request.id", ["data_request.id"]);
  if (t === "customers/data_request" && dr != null) req.dataRequestId = String(dr);
  return req;
}

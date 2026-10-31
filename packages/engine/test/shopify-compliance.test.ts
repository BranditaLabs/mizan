import { describe, expect, it } from "vitest";
import { DriftMonitor } from "../src/adapt/drift.js";
import { SchemaDriftError } from "../src/adapt/resolve.js";
import { parseComplianceWebhook } from "../src/connectors/shopify/compliance.js";

const drift = new DriftMonitor();
const now = () => 0;
// Shapes from shopify.dev (privacy law compliance), numbers as Shopify sends them.
const SHOP = "nile.myshopify.com";

describe("Shopify compliance webhooks", () => {
  it("customers/redact → order GIDs and the customer to match", () => {
    const r = parseComplianceWebhook("customers/redact", {
      shop_id: 954889, shop_domain: SHOP, customer: { id: 191167, email: "john@example.com", phone: "555-625-1199" }, orders_to_redact: [299938, 280263],
    }, drift, now);
    expect(r).toEqual({
      topic: "customers/redact", shop: SHOP, orderIds: ["gid://shopify/Order/299938", "gid://shopify/Order/280263"],
      customer: { id: "191167", email: "john@example.com", phone: "555-625-1199" },
    });
  });

  it("customers/data_request carries Shopify's request id", () => {
    const r = parseComplianceWebhook("CUSTOMERS/DATA_REQUEST", {
      shop_domain: SHOP, orders_requested: [299938], customer: { id: 191167 }, data_request: { id: 9999 },
    }, drift, now);
    expect(r).toMatchObject({ topic: "customers/data_request", orderIds: ["gid://shopify/Order/299938"], dataRequestId: "9999", customer: { id: "191167" } });
  });

  it("shop/redact names only the shop; other topics are not compliance requests", () => {
    expect(parseComplianceWebhook("shop/redact", { shop_id: 1, shop_domain: "Nile.myshopify.com" }, drift, now)).toEqual({ topic: "shop/redact", shop: SHOP, orderIds: [] });
    expect(parseComplianceWebhook("orders/create", { shop_domain: SHOP }, drift, now)).toBeNull();
    expect(() => parseComplianceWebhook("shop/redact", { shop_id: 1 }, drift, now)).toThrow(SchemaDriftError);
  });
});

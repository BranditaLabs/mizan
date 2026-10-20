import type { CanonicalOrder, CanonicalProduct, Money, PaymentMode, PaymentStatus } from "@mizan/shared";
import { toMinor } from "@mizan/shared";
import type { DriftSink } from "../../adapt/drift.js";
import { Resolver } from "../../adapt/resolve.js";

/**
 * Shopify → canonical mapping, written against candidate paths rather than
 * fixed fields, so renamed or relocated fields degrade into drift events
 * instead of broken orders.
 */

/**
 * Payment method detection from gateway names. Shopify reports manual methods
 * by the name the merchant typed, so patterns cover English and Arabic.
 * Merchants can extend any list through connector options.
 */
export const PAYMENT_PATTERNS = {
  cod: [/cash on delivery/i, /\bcod\b/i, /الدفع عند الاستلام/, /كاش/, /cash/i],
  bnpl: [/tabby/i, /tamara/i, /\bvalu\b/i, /sympl/i, /souhoola/i, /aman/i, /postpay/i, /cashew/i, /contact ?pay/i, /تقسيط/],
  bank: [/bank (deposit|transfer)/i, /instapay/i, /wire/i, /money order/i, /تحويل بنكي/, /إنستاباي|انستاباي/],
};

export interface MapCtx {
  drift: DriftSink;
  now: () => number;
  /** Extra COD gateway patterns (kept for backward compatibility). */
  codPatterns?: RegExp[];
  paymentPatterns?: Partial<Record<keyof typeof PAYMENT_PATTERNS, RegExp[]>>;
}

const STATUS: Record<string, PaymentStatus> = {
  PENDING: "unpaid", AUTHORIZED: "authorized", PARTIALLY_PAID: "partially_paid", PAID: "paid",
  PARTIALLY_REFUNDED: "partially_refunded", REFUNDED: "refunded", VOIDED: "voided", EXPIRED: "failed",
};

export function detectPayment(gateways: string[], financial: string | undefined, received: Money | undefined, ctx: Pick<MapCtx, "codPatterns" | "paymentPatterns">): { mode: PaymentMode; status: PaymentStatus } {
  const f = (financial ?? "").toUpperCase();
  const status: PaymentStatus = STATUS[f] ?? "unknown";
  const pat = {
    cod: [...PAYMENT_PATTERNS.cod, ...(ctx.codPatterns ?? []), ...(ctx.paymentPatterns?.cod ?? [])],
    bnpl: [...PAYMENT_PATTERNS.bnpl, ...(ctx.paymentPatterns?.bnpl ?? [])],
    bank: [...PAYMENT_PATTERNS.bank, ...(ctx.paymentPatterns?.bank ?? [])],
  };
  const is = (list: RegExp[]) => gateways.some((g) => list.some((p) => p.test(String(g))));
  const hasCod = is(pat.cod);
  const hasBnpl = is(pat.bnpl);
  const hasBank = !hasBnpl && is(pat.bank);
  const hasOnline = gateways.some((g) => ![...pat.cod, ...pat.bnpl, ...pat.bank].some((p) => p.test(String(g))) && !/^manual$/i.test(String(g)));
  const receivedSome = received ? safeMinor(received) > 0n : f === "PARTIALLY_PAID";

  let mode: PaymentMode;
  if (hasCod && (receivedSome || hasOnline) && f !== "PAID") mode = "partial"; // deposit online + balance on delivery
  else if (hasCod) mode = "cod";
  else if (hasBnpl) mode = "bnpl";
  else if (hasBank) mode = "bank_transfer";
  else if (hasOnline || ["PAID", "AUTHORIZED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(f)) mode = "prepaid";
  else if (f === "PARTIALLY_PAID") mode = "partial";
  else mode = "unknown"; // never guess: an unknown method could mean cash is owed
  return { mode, status };
}

function safeMinor(m: Money): bigint {
  try { return toMinor(m); } catch { return 0n; }
}

function money(r: Resolver, field: string, paths: string[], fallbackCurrency: string): Money | undefined {
  const amount = r.str(field, paths.map((p) => `${p}.shopMoney.amount`).concat(paths.map((p) => `${p}.amount`)));
  if (amount === undefined) return undefined;
  const currency = r.str(`${field}.currency`, paths.map((p) => `${p}.shopMoney.currencyCode`).concat(paths.map((p) => `${p}.currencyCode`))) ?? fallbackCurrency;
  return { amount, currency };
}

export function mapOrder(raw: unknown, ctx: MapCtx): CanonicalOrder {
  const r = new Resolver(raw, { connector: "shopify", entity: "order", drift: ctx.drift, now: ctx.now });
  const currency = r.str("currency", ["currencyCode", "presentmentCurrencyCode", "totalPriceSet.shopMoney.currencyCode"]) ?? "EGP";
  const total = money(r, "total", ["totalPriceSet", "currentTotalPriceSet"], currency);
  if (!total) r.any("total", ["totalPriceSet.shopMoney.amount"], { required: true });

  const gateways = r.arr<string>("paymentGatewayNames", ["paymentGatewayNames", "paymentGateways"]).map(String);
  const financial = r.str("financialStatus", ["displayFinancialStatus", "financialStatus"]);
  const received = money(r, "received", ["totalReceivedSet"], currency);
  const outstanding = money(r, "outstanding", ["totalOutstandingSet"], currency);
  const refunded = money(r, "refunded", ["totalRefundedSet"], currency);
  const { mode: paymentMode, status: paymentStatus } = detectPayment(gateways, financial, received, ctx);

  const first = r.str("customer.firstName", ["shippingAddress.firstName", "customer.firstName"]);
  const last = r.str("customer.lastName", ["shippingAddress.lastName", "customer.lastName"]);
  const fullName =
    r.str("customer.name", ["shippingAddress.name", "customer.displayName"]) ?? [first, last].filter(Boolean).join(" ") ?? "Customer";

  const sa = r.any("shippingAddress", ["shippingAddress"]);
  const addr = sa ? r.child(sa, "order.shippingAddress") : undefined;

  const lines = r.arr("lineItems", ["lineItems", "line_items"]).map((li) => {
    const lr = r.child(li, "order.lineItem");
    return {
      externalLineId: lr.str("id", ["id", "admin_graphql_api_id"], { required: true })!,
      sku: lr.str("sku", ["sku", "variant.sku"]),
      title: lr.str("title", ["title", "name"]) ?? "Item",
      quantity: lr.num("quantity", ["quantity", "currentQuantity"]) ?? 1,
      unitPrice: money(lr, "unitPrice", ["originalUnitPriceSet", "discountedUnitPriceSet", "price"], currency) ?? { amount: "0", currency },
    };
  });

  const fulfillmentGroups = r.arr("fulfillmentOrders", ["fulfillmentOrders"]).map((fo) => {
    const fr = r.child(fo, "order.fulfillmentOrder");
    return {
      externalId: fr.str("id", ["id"], { required: true })!,
      status: fr.str("status", ["status"]) ?? "UNKNOWN",
      lineIds: fr.arr("lineItems", ["lineItems"]).map((n) => r.child(n).str("lineItemId", ["lineItem.id", "lineItemId"]) ?? "").filter(Boolean),
    };
  });

  return {
    connector: "shopify",
    externalId: r.str("id", ["id", "admin_graphql_api_id"], { required: true })!,
    number: r.str("number", ["name", "orderNumber", "order_number"]) ?? "",
    createdAt: r.str("createdAt", ["createdAt", "created_at"]) ?? new Date(ctx.now()).toISOString(),
    updatedAt: r.str("updatedAt", ["updatedAt", "updated_at"]) ?? new Date(ctx.now()).toISOString(),
    currency,
    total: total ?? { amount: "0", currency },
    subtotal: money(r, "subtotal", ["subtotalPriceSet"], currency),
    shipping: money(r, "shipping", ["totalShippingPriceSet"], currency),
    paymentMode,
    paymentStatus,
    financialStatus: financial,
    gateways,
    received,
    outstanding,
    refunded,
    cancelled: Boolean(r.any("cancelledAt", ["cancelledAt", "cancelled_at"])),
    customer: {
      name: fullName || "Customer",
      phone: r.str("customer.phone", ["shippingAddress.phone", "customer.defaultPhoneNumber.phoneNumber", "customer.phone", "phone", "billingAddress.phone"]),
      email: r.str("customer.email", ["customer.defaultEmailAddress.emailAddress", "customer.email", "email"]),
    },
    shippingAddress: addr && {
      name: addr.str("name", ["name"]),
      phone: addr.str("phone", ["phone"]),
      line1: addr.str("line1", ["address1", "line1"]) ?? "",
      line2: addr.str("line2", ["address2", "line2"]),
      city: addr.str("city", ["city"]) ?? "",
      province: addr.str("province", ["province", "provinceCode"]),
      zip: addr.str("zip", ["zip"]),
      countryCode: addr.str("countryCode", ["countryCodeV2", "countryCode", "country_code"]) ?? "EG",
    },
    lines,
    fulfillmentGroups,
    tags: r.arr<string>("tags", ["tags"]).map(String),
    raw,
  };
}

export function mapProduct(raw: unknown, ctx: MapCtx): CanonicalProduct {
  const r = new Resolver(raw, { connector: "shopify", entity: "product", drift: ctx.drift, now: ctx.now });
  const status = (r.str("status", ["status"]) ?? "").toLowerCase();
  const tagsRaw = r.any("tags", ["tags"]);
  const tags = Array.isArray(tagsRaw) ? tagsRaw.map(String) : typeof tagsRaw === "string" ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean) : [];
  return {
    connector: "shopify",
    externalId: r.str("id", ["id", "admin_graphql_api_id"], { required: true })!,
    title: r.str("title", ["title"]) ?? "",
    status: status === "active" || status === "draft" || status === "archived" ? status : "unknown",
    vendor: r.str("vendor", ["vendor"]),
    productType: r.str("productType", ["productType", "product_type"]),
    tags,
    descriptionHtml: r.str("descriptionHtml", ["descriptionHtml", "body_html"]),
    updatedAt: r.str("updatedAt", ["updatedAt", "updated_at"]) ?? new Date(ctx.now()).toISOString(),
    variants: r.arr("variants", ["variants"]).map((v) => {
      const vr = r.child(v, "product.variant");
      const price = vr.str("price", ["price", "price.amount"]) ?? "0"; // Money scalar in current versions; MoneyV2 object in older ones
      const cap = vr.str("compareAtPrice", ["compareAtPrice", "compareAtPrice.amount", "compare_at_price"]);
      return {
        externalId: vr.str("id", ["id", "admin_graphql_api_id"], { required: true })!,
        sku: vr.str("sku", ["sku"]),
        title: vr.str("title", ["title"]),
        price: { amount: price, currency: "" },
        compareAtPrice: cap ? { amount: cap, currency: "" } : null,
        inventoryItemId: vr.str("inventoryItemId", ["inventoryItem.id", "inventory_item_id"]),
        available: vr.num("available", ["inventoryQuantity", "inventory_quantity"]),
      };
    }),
    raw,
  };
}

/** Webhook payloads are REST-shaped; resolve the GraphQL id to re-fetch the full record. */
export function gidFromWebhook(kind: "Order" | "Product", payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const p = payload as Record<string, unknown>;
  if (typeof p.admin_graphql_api_id === "string") return p.admin_graphql_api_id;
  if (p.id !== undefined && p.id !== null) return `gid://shopify/${kind}/${p.id}`;
  return undefined;
}

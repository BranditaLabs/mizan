import type { Address, CanonicalOrder, CanonicalProduct, Money, PaymentMode, PaymentStatus } from "@mizan/shared";
import { fromMinor, toMinor } from "@mizan/shared";
import type { DriftSink } from "../../adapt/drift.js";
import { Resolver } from "../../adapt/resolve.js";
import { PAYMENT_PATTERNS } from "../shopify/mapper.js";

/**
 * WooCommerce → canonical mapping (REST v3 order), through candidate paths only.
 *
 * Payment facts from WooCommerce's own gateways (source, trunk):
 * - `cod` (Cash on delivery) puts the order in `processing` (or `on-hold` with downloads) WITHOUT
 *   taking payment — yet `processing` stamps `date_paid`. So for COD, `date_paid` and the status
 *   never mean "paid": the courier collects the total.
 * - `bacs` (bank transfer) and `cheque` wait in `on-hold` until the merchant sees the money and
 *   moves the order on (which stamps `date_paid`).
 * - Online gateways (Paymob, Kashier, Stripe, Fawry…) leave the order `pending` until paid; paid →
 *   `processing`/`completed` with `date_paid`. `on-hold` is never read as authorized: unknown
 *   cases do not ship.
 * - `refunds[].total` are negative strings; `status: refunded` is a full refund.
 */

export interface WooMapCtx {
  drift: DriftSink;
  now: () => number;
  paymentPatterns?: Partial<Record<keyof typeof PAYMENT_PATTERNS, RegExp[]>>;
}

/** WooCommerce's Egyptian state codes (i18n/states.php) → the governorate's name, as couriers read it. */
export const EG_STATES: Readonly<Record<string, string>> = {
  EGALX: "Alexandria", EGASN: "Aswan", EGAST: "Asyut", EGBA: "Red Sea", EGBH: "Beheira", EGBNS: "Beni Suef", EGC: "Cairo",
  EGDK: "Dakahlia", EGDT: "Damietta", EGFYM: "Faiyum", EGGH: "Gharbia", EGGZ: "Giza", EGIS: "Ismailia", EGJS: "South Sinai",
  EGKB: "Qalyubia", EGKFS: "Kafr el-Sheikh", EGKN: "Qena", EGLX: "Luxor", EGMN: "Minya", EGMNF: "Monufia", EGMT: "Matrouh",
  EGPTS: "Port Said", EGSHG: "Sohag", EGSHR: "Al Sharqia", EGSIN: "North Sinai", EGSUZ: "Suez", EGWAD: "New Valley",
};

const PAID_STATUSES = new Set(["processing", "completed"]);

export function detectWooPayment(
  p: { method: string; title: string; status: string; datePaid: boolean; total: bigint; refunded: bigint },
  ctx: Pick<WooMapCtx, "paymentPatterns">,
): { mode: PaymentMode; status: PaymentStatus } {
  const method = p.method.toLowerCase();
  const label = `${p.method} ${p.title}`;
  const is = (key: keyof typeof PAYMENT_PATTERNS) => [...PAYMENT_PATTERNS[key], ...(ctx.paymentPatterns?.[key] ?? [])].some((re) => re.test(label));

  let mode: PaymentMode;
  if (method === "cod" || is("cod")) mode = "cod";
  else if (is("bnpl")) mode = "bnpl";
  else if (method === "bacs" || method === "cheque" || is("bank")) mode = "bank_transfer";
  else if (method) mode = "prepaid";
  else mode = p.total === 0n ? "prepaid" : "unknown"; // an order typed in wp-admin without a method: never guess

  const s = p.status.toLowerCase();
  let status: PaymentStatus;
  if (s === "refunded") status = "refunded";
  else if (s === "failed") status = "failed";
  else if (mode === "cod") status = "unpaid"; // date_paid lies for COD (see above)
  else if (p.datePaid && PAID_STATUSES.has(s)) status = "paid";
  else if (p.datePaid && (s === "cancelled" || s === "trash")) status = "paid";
  else if (s === "cancelled" || s === "trash") status = "voided";
  else if (s === "pending" || s === "on-hold") status = "unpaid";
  else if (p.total === 0n && PAID_STATUSES.has(s)) status = "paid";
  else status = "unknown";
  if (status === "paid" && p.refunded > 0n) status = p.refunded >= p.total ? "refunded" : "partially_refunded";
  return { mode, status };
}

/** "2026-10-27T10:00:00" (GMT, no zone, as WooCommerce sends `*_gmt`) → ISO with Z. */
function gmt(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const s = /[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : `${v}Z`;
  const t = Date.parse(s);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

function minor(amount: string | undefined, currency: string): bigint {
  if (amount === undefined) return 0n;
  try { return toMinor({ amount: amount.replace(/^-/, ""), currency }); } catch { return 0n; }
}

export function mapWooOrder(raw: unknown, ctx: WooMapCtx): CanonicalOrder {
  const r = new Resolver(raw, { connector: "woocommerce", entity: "order", drift: ctx.drift, now: ctx.now });
  const id = r.str("id", ["id"], { required: true })!;
  const currency = (r.str("currency", ["currency", "currency_code"]) ?? "EGP").toUpperCase();
  const totalStr = r.str("total", ["total"], { required: true })!;
  const total = minor(totalStr, currency);
  const refunded = r.arr<unknown>("refunds", ["refunds"]).reduce<bigint>((sum, x) => sum + minor(r.child(x, "order.refund").str("total", ["total", "amount"]), currency), 0n);
  const status = (r.str("status", ["status"]) ?? "").toLowerCase();
  const method = r.str("payment_method", ["payment_method"]) ?? "";
  const title = r.str("payment_method_title", ["payment_method_title"]) ?? "";
  const datePaid = Boolean(r.any("date_paid", ["date_paid_gmt", "date_paid"]));
  const { mode, status: paymentStatus } = detectWooPayment({ method, title, status, datePaid, total, refunded }, ctx);
  const money = (m: bigint): Money => fromMinor(m, currency);
  const received = paymentStatus === "paid" || paymentStatus === "partially_refunded" || paymentStatus === "refunded" ? total : 0n;
  const outstanding = mode === "cod" ? (status === "refunded" ? 0n : total) : received >= total ? 0n : total - received;

  // Many Egyptian stores hide the shipping form: the billing block is then the delivery address.
  const shipLine = r.str("shipping.address_1", ["shipping.address_1"]);
  const block = shipLine ? "shipping" : "billing";
  const a = r.child(r.any(block, [block]) ?? {}, `order.${block}`);
  const billing = r.child(r.any("billing", ["billing"]) ?? {}, "order.billing");
  const name = [a.str("first_name", ["first_name"]), a.str("last_name", ["last_name"])].filter(Boolean).join(" ")
    || [billing.str("first_name", ["first_name"]), billing.str("last_name", ["last_name"])].filter(Boolean).join(" ") || "Customer";
  // shipping.phone exists since WooCommerce 5.6 and is usually empty; billing.phone is the checkout's phone.
  const phone = r.str("shipping.phone", ["shipping.phone"]) ?? billing.str("phone", ["phone"]);
  const country = (a.str("country", ["country"]) ?? billing.str("country", ["country"]) ?? "EG").toUpperCase();
  const state = a.str("state", ["state"]);
  const line1 = a.str("address_1", ["address_1"]);
  const address: Address | undefined = line1 || a.str("city", ["city"]) ? {
    name, ...(phone ? { phone } : {}), line1: line1 ?? "", line2: a.str("address_2", ["address_2"]) || undefined,
    city: a.str("city", ["city"]) ?? "", province: state ? (country === "EG" ? EG_STATES[state.toUpperCase()] ?? state : state) : undefined,
    zip: a.str("postcode", ["postcode"]) || undefined, countryCode: country,
  } : undefined;

  const lines = r.arr("line_items", ["line_items"]).map((li) => {
    const lr = r.child(li, "order.lineItem");
    const qty = lr.num("quantity", ["quantity"]) ?? 1;
    const variation = lr.num("variation_id", ["variation_id"]) ?? 0;
    // `price` is a number in responses (docs say string); subtotal / quantity when it is missing.
    const price = lr.str("price", ["price"]) ?? (() => { const sub = lr.str("subtotal", ["subtotal"]); return sub ? fromMinor(minor(sub, currency) / BigInt(Math.max(1, qty)), currency).amount : "0"; })();
    return {
      externalLineId: lr.str("id", ["id"], { required: true })!,
      sku: lr.str("sku", ["sku"]) || undefined,
      variantExternalId: variation > 0 ? String(variation) : lr.str("product_id", ["product_id"]) || undefined,
      title: lr.str("name", ["name", "title"]) ?? "Item",
      quantity: qty,
      unitPrice: { amount: normalize(price, currency), currency },
    };
  });

  const created = gmt(r.str("date_created_gmt", ["date_created_gmt", "date_created"]));
  const modified = gmt(r.str("date_modified_gmt", ["date_modified_gmt", "date_modified"]));
  return {
    connector: "woocommerce",
    externalId: id,
    number: `#${r.str("number", ["number"]) ?? id}`,
    createdAt: created ?? new Date(ctx.now()).toISOString(),
    updatedAt: modified ?? created ?? new Date(ctx.now()).toISOString(),
    currency,
    total: money(total),
    subtotal: money(r.arr("line_items", ["line_items"]).reduce<bigint>((s, li) => s + minor(r.child(li).str("subtotal", ["subtotal"]), currency), 0n)),
    shipping: money(minor(r.str("shipping_total", ["shipping_total"]), currency)),
    paymentMode: mode,
    paymentStatus,
    financialStatus: status,
    gateways: [title || method].filter(Boolean),
    received: money(received),
    outstanding: money(outstanding > 0n ? outstanding : 0n),
    refunded: money(refunded),
    cancelled: status === "cancelled" || status === "trash",
    customer: { name, ...(phone ? { phone } : {}), ...(billing.str("email", ["email"]) ? { email: billing.str("email", ["email"]) } : {}) },
    ...(address ? { shippingAddress: address } : {}),
    lines,
    fulfillmentGroups: [],
    tags: [],
    raw,
  };
}

/** "575" / 575.5 → "575.00" / "575.50" in the currency's minor units. */
function normalize(amount: string, currency: string): string {
  try { return fromMinor(toMinor({ amount, currency }), currency).amount; } catch { return amount; }
}

/** The order id in a webhook body (the full order for created/updated; `{ id }` for deleted). */
export function wooOrderIdFromWebhook(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const id = (payload as Record<string, unknown>).id;
  return typeof id === "number" || (typeof id === "string" && id) ? String(id) : undefined;
}

const PRODUCT_STATUS: Record<string, CanonicalProduct["status"]> = { publish: "active", draft: "draft", pending: "draft", private: "draft" };

/**
 * A WooCommerce product → canonical (E5-7). A simple product is its own single variant (its id is
 * what order lines carry as `product_id`); a variable product's variants are its variations (order
 * lines carry `variation_id`). `price` is the current price; on sale, `regular_price` is the
 * compare-at price. Stock counts only when WooCommerce manages it: a variation with
 * `manage_stock: "parent"` shares the product's count. An unpriced product has `price: ""`.
 */
export function mapWooProduct(raw: unknown, variations: unknown[], ctx: WooMapCtx): CanonicalProduct {
  const r = new Resolver(raw, { connector: "woocommerce", entity: "product", drift: ctx.drift, now: ctx.now });
  const id = r.str("id", ["id"], { required: true })!;
  const type = (r.str("type", ["type"]) ?? "simple").toLowerCase();
  const managed = (x: Resolver) => x.any("manage_stock", ["manage_stock"]);
  const parentStock = managed(r) === true ? r.num("stock_quantity", ["stock_quantity"]) : undefined;
  // Where the count lives, as the stock push targets it (E8-5): the product, or the variation itself.
  const variant = (x: Resolver, externalId: string, title: string | undefined, isVariation = false) => {
    const price = x.str("price", ["price"]) || x.str("regular_price", ["regular_price"]) || "0";
    const regular = x.str("regular_price", ["regular_price"]);
    const onSale = Boolean(x.str("sale_price", ["sale_price"])) && regular !== undefined && regular !== price;
    const m = managed(x);
    const available = m === true ? x.num("stock_quantity", ["stock_quantity"]) : m === "parent" ? parentStock : undefined;
    const stockAt = m === true ? (isVariation ? wooStockTarget(id, externalId) : wooStockTarget(id)) : m === "parent" && parentStock !== undefined ? wooStockTarget(id) : undefined;
    return {
      externalId,
      sku: x.str("sku", ["sku"]) || undefined,
      barcode: x.str("barcode", ["global_unique_id"])?.trim() || undefined,
      ...(title ? { title } : {}),
      price: { amount: price, currency: "" },
      compareAtPrice: onSale ? { amount: regular!, currency: "" } : null,
      ...(available !== undefined ? { available } : {}),
      ...(stockAt ? { inventoryItemId: stockAt } : {}),
    };
  };
  const variants = type === "variable"
    ? variations.map((v) => {
      const vr = r.child(v, "product.variation");
      const attrs = vr.arr<{ option?: unknown }>("attributes", ["attributes"]).map((a) => (a && typeof a.option === "string" ? a.option : "")).filter(Boolean);
      return variant(vr, vr.str("id", ["id"], { required: true })!, attrs.join(" / ") || undefined, true);
    })
    : [variant(r, id, "Default")];
  const tags = r.arr<{ name?: unknown }>("tags", ["tags"]).map((t) => (t && typeof t.name === "string" ? t.name : "")).filter(Boolean);
  const category = r.arr<{ name?: unknown }>("categories", ["categories"]).map((c) => (c && typeof c.name === "string" ? c.name : "")).find(Boolean);
  return {
    connector: "woocommerce",
    externalId: id,
    title: r.str("name", ["name"]) ?? "",
    status: PRODUCT_STATUS[(r.str("status", ["status"]) ?? "").toLowerCase()] ?? "unknown",
    ...(category ? { productType: category } : {}),
    tags,
    descriptionHtml: r.str("description", ["description"]),
    updatedAt: gmt(r.str("date_modified_gmt", ["date_modified_gmt", "date_modified"])) ?? new Date(ctx.now()).toISOString(),
    variants,
    raw,
  };
}

/** The product id in a webhook body (the full product for created/updated; `{ id }` for deleted). */
export const wooProductIdFromWebhook = wooOrderIdFromWebhook;

/** "product:12" or "variation:12:34": the record whose `stock_quantity` holds a variant's count. */
export function wooStockTarget(productId: string, variationId?: string): string {
  return variationId ? `variation:${productId}:${variationId}` : `product:${productId}`;
}

export function parseWooStockTarget(target: string): { productId: string; variationId?: string } | null {
  const m = /^(product|variation):(\d+)(?::(\d+))?$/.exec(target);
  if (!m) return null;
  return m[1] === "variation" && m[3] ? { productId: m[2]!, variationId: m[3] } : m[1] === "product" && !m[3] ? { productId: m[2]! } : null;
}

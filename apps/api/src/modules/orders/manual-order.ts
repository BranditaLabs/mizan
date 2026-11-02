import { fromMinor, toMinor, type CanonicalOrder, type OrderSourceHints } from "@mizan/shared";

/**
 * A manual order (E5-5), pure: what the team typed (a phone, WhatsApp or Instagram order) becomes a
 * canonical order like any store's, so duplicates, risk, routing, confirmation and profit treat it
 * the same. Money in minor units throughout; the payment decides what the courier collects.
 */
export const ORDER_SOURCES = ["phone", "whatsapp", "instagram", "facebook", "tiktok", "walk_in", "other"] as const;

/** What the team said about where a typed-in order came from, as source hints (M7-2). */
const SOURCE_HINTS: Record<(typeof ORDER_SOURCES)[number], OrderSourceHints> = {
  phone: { channel: "manual" }, other: { channel: "manual" }, walk_in: { channel: "pos" }, whatsapp: { channel: "whatsapp" },
  instagram: { lastVisit: { source: "instagram" } }, facebook: { lastVisit: { source: "facebook" } }, tiktok: { lastVisit: { source: "tiktok" } },
};
export const MANUAL_PAYMENT_MODES = ["cod", "prepaid", "partial", "bank_transfer"] as const;
export const MONEY_IN_METHODS = ["wallet", "card", "instapay"] as const;

export interface ManualOrderInput {
  source: (typeof ORDER_SOURCES)[number];
  customer: { name: string; phone: string };
  address: { line1: string; line2?: string | undefined; city: string; province?: string | undefined };
  lines: Array<{ variantId?: string | undefined; title?: string | undefined; quantity: number; unitPrice?: string | undefined }>;
  shipping: string;
  discount: string;
  payment: { mode: (typeof MANUAL_PAYMENT_MODES)[number]; method?: (typeof MONEY_IN_METHODS)[number] | undefined; paid?: string | undefined };
}

export interface CatalogueVariant { id: string; title: string; sku: string | null; priceMinor: bigint; currency: string }

export type ManualOrderError = "unknown_product" | "currency_mismatch" | "total_invalid" | "paid_invalid";

const GATEWAY: Record<(typeof MONEY_IN_METHODS)[number], string> = { wallet: "Wallet", card: "Card", instapay: "InstaPay" };

export function buildManualOrder(
  input: ManualOrderInput,
  ctx: { variants: ReadonlyMap<string, CatalogueVariant>; baseCurrency: string; country: string; number: string; externalId: string; now: Date },
): { order: CanonicalOrder; variantIds: Record<string, string> } | { error: ManualOrderError } {
  const picked = input.lines.filter((l) => l.variantId).map((l) => ctx.variants.get(l.variantId!));
  if (picked.some((v) => !v)) return { error: "unknown_product" };
  const currencies = new Set(picked.map((v) => v!.currency));
  if (currencies.size > 1) return { error: "currency_mismatch" };
  const currency = [...currencies][0] ?? ctx.baseCurrency;
  const m = (amount: string) => toMinor({ amount, currency });

  const variantIds: Record<string, string> = {};
  const lines = input.lines.map((l, i) => {
    const v = l.variantId ? ctx.variants.get(l.variantId)! : null;
    const unit = l.unitPrice !== undefined ? m(l.unitPrice) : v!.priceMinor;
    const externalLineId = `L${i + 1}`;
    if (v) variantIds[externalLineId] = v.id;
    return { externalLineId, ...(v?.sku ? { sku: v.sku } : {}), title: v ? v.title : l.title!, quantity: l.quantity, unitPrice: fromMinor(unit, currency), unitMinor: unit };
  });
  const subtotal = lines.reduce((a, l) => a + l.unitMinor * BigInt(l.quantity), 0n);
  const shipping = m(input.shipping);
  const total = subtotal + shipping - m(input.discount);
  if (total <= 0n) return { error: "total_invalid" };

  const p = input.payment;
  const paidIn = p.paid !== undefined ? m(p.paid) : null;
  let paid: bigint;
  let status: CanonicalOrder["paymentStatus"];
  switch (p.mode) {
    case "cod":
      if (paidIn) return { error: "paid_invalid" }; // a deposit makes it a partial order
      paid = 0n; status = "unpaid"; break;
    case "prepaid":
      if (paidIn !== null && paidIn !== total) return { error: "paid_invalid" };
      paid = total; status = "paid"; break;
    case "partial":
      if (paidIn === null || paidIn <= 0n || paidIn >= total) return { error: "paid_invalid" };
      paid = paidIn; status = "partially_paid"; break;
    case "bank_transfer":
      if (paidIn !== null && paidIn !== 0n && paidIn !== total) return { error: "paid_invalid" };
      paid = paidIn ?? 0n; status = paid ? "paid" : "unpaid"; break;
  }
  const gateways = p.mode === "cod" ? ["Cash on Delivery (COD)"]
    : p.mode === "bank_transfer" ? [p.method === "instapay" ? "InstaPay" : "Bank transfer"]
    : [GATEWAY[p.method ?? "wallet"], ...(p.mode === "partial" ? ["Cash on Delivery (COD)"] : [])];
  const money = (x: bigint) => fromMinor(x, currency);
  const at = ctx.now.toISOString();
  return {
    variantIds,
    order: {
      connector: "manual", externalId: ctx.externalId, number: ctx.number, createdAt: at, updatedAt: at, currency,
      total: money(total), subtotal: money(subtotal), shipping: money(shipping), paymentMode: p.mode, paymentStatus: status, gateways,
      received: money(paid), outstanding: money(total - paid), refunded: money(0n), cancelled: false,
      customer: { name: input.customer.name, phone: input.customer.phone },
      shippingAddress: {
        name: input.customer.name, phone: input.customer.phone, line1: input.address.line1, ...(input.address.line2 ? { line2: input.address.line2 } : {}),
        city: input.address.city, ...(input.address.province ? { province: input.address.province } : {}), countryCode: ctx.country,
      },
      lines: lines.map(({ unitMinor: _, ...l }) => l),
      fulfillmentGroups: [], tags: [`source:${input.source}`], source: SOURCE_HINTS[input.source],
    },
  };
}

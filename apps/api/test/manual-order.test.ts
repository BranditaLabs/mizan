import { cashToCollect } from "@mizan/engine";
import { describe, expect, it } from "vitest";
import { buildManualOrder, type CatalogueVariant, type ManualOrderInput } from "../src/modules/orders/manual-order.js";

/** E5-5: what the team types becomes a canonical order; the payment decides what the courier collects. */
const abaya: CatalogueVariant = { id: "v-abaya", title: "Abaya — Black / L", sku: "AB-1", priceMinor: 125000n, currency: "EGP" };
const riyal: CatalogueVariant = { id: "v-sar", title: "Scarf", sku: null, priceMinor: 9000n, currency: "SAR" };
const ctx = { variants: new Map([[abaya.id, abaya], [riyal.id, riyal]]), baseCurrency: "EGP", country: "EG", number: "M-1001", externalId: "manual:x", now: new Date("2026-10-24T10:00:00Z") };
const input = (over: Partial<ManualOrderInput> = {}): ManualOrderInput => ({
  source: "phone", customer: { name: "Mona Adel", phone: "01001234821" }, address: { line1: "12 Abbas El Akkad St", city: "Nasr City" },
  lines: [{ variantId: abaya.id, quantity: 2 }, { title: "Gift wrap", quantity: 1, unitPrice: "25" }], shipping: "50", discount: "100", payment: { mode: "cod" }, ...over,
});
const ok = (r: ReturnType<typeof buildManualOrder>) => { if ("error" in r) throw new Error(r.error); return r; };

describe("manual order", () => {
  it("cash on delivery: catalogue price, free items, shipping and discount; the courier collects the total", () => {
    const { order, variantIds } = ok(buildManualOrder(input(), ctx));
    expect(order).toMatchObject({
      connector: "manual", number: "M-1001", currency: "EGP", subtotal: { amount: "2525.00" }, shipping: { amount: "50.00" }, total: { amount: "2475.00" },
      paymentMode: "cod", paymentStatus: "unpaid", received: { amount: "0.00" }, outstanding: { amount: "2475.00" }, tags: ["source:phone"],
      shippingAddress: { line1: "12 Abbas El Akkad St", city: "Nasr City", countryCode: "EG", phone: "01001234821" },
    });
    expect(order.lines).toEqual([
      { externalLineId: "L1", sku: "AB-1", title: "Abaya — Black / L", quantity: 2, unitPrice: { amount: "1250.00", currency: "EGP" } },
      { externalLineId: "L2", title: "Gift wrap", quantity: 1, unitPrice: { amount: "25.00", currency: "EGP" } },
    ]);
    expect(variantIds).toEqual({ L1: "v-abaya" });
    expect(cashToCollect(order).amount).toBe("2475.00");
  });

  it("a price the team agreed on the phone overrides the catalogue", () => {
    const { order } = ok(buildManualOrder(input({ lines: [{ variantId: abaya.id, quantity: 1, unitPrice: "1100" }], shipping: "0", discount: "0" }), ctx));
    expect(order.total.amount).toBe("1100.00");
  });

  it("deposit now, the rest on delivery; paid in full; a transfer that waits or has arrived", () => {
    const partial = ok(buildManualOrder(input({ payment: { mode: "partial", method: "instapay", paid: "500" } }), ctx)).order;
    expect(partial).toMatchObject({ paymentStatus: "partially_paid", received: { amount: "500.00" }, outstanding: { amount: "1975.00" }, gateways: ["InstaPay", "Cash on Delivery (COD)"] });
    expect(cashToCollect(partial).amount).toBe("1975.00");
    const prepaid = ok(buildManualOrder(input({ payment: { mode: "prepaid", method: "card" } }), ctx)).order;
    expect(prepaid).toMatchObject({ paymentStatus: "paid", received: { amount: "2475.00" }, gateways: ["Card"] });
    expect(cashToCollect(prepaid).amount).toBe("0.00");
    const waiting = ok(buildManualOrder(input({ payment: { mode: "bank_transfer" } }), ctx)).order;
    expect(waiting).toMatchObject({ paymentStatus: "unpaid", gateways: ["Bank transfer"] });
    expect(() => cashToCollect(waiting)).toThrow(); // never ships before the money arrives
    expect(ok(buildManualOrder(input({ payment: { mode: "bank_transfer", method: "instapay", paid: "2475" } }), ctx)).order).toMatchObject({ paymentStatus: "paid", gateways: ["InstaPay"] });
  });

  it("refuses what does not add up", () => {
    expect(buildManualOrder(input({ lines: [{ variantId: "v-gone", quantity: 1 }] }), ctx)).toEqual({ error: "unknown_product" });
    expect(buildManualOrder(input({ lines: [{ variantId: abaya.id, quantity: 1 }, { variantId: riyal.id, quantity: 1 }] }), ctx)).toEqual({ error: "currency_mismatch" });
    expect(buildManualOrder(input({ discount: "5000" }), ctx)).toEqual({ error: "total_invalid" });
    for (const payment of [
      { mode: "cod", paid: "100" }, { mode: "partial" }, { mode: "partial", paid: "0" }, { mode: "partial", paid: "2475" },
      { mode: "prepaid", paid: "100" }, { mode: "bank_transfer", paid: "100" },
    ] as const) expect(buildManualOrder(input({ payment }), ctx)).toEqual({ error: "paid_invalid" });
  });

  it("free items only: the store's currency", () => {
    const { order } = ok(buildManualOrder(input({ lines: [{ title: "Custom abaya", quantity: 1, unitPrice: "1800.5" }], shipping: "0", discount: "0" }), { ...ctx, baseCurrency: "SAR", country: "SA" }));
    expect(order).toMatchObject({ currency: "SAR", total: { amount: "1800.50", currency: "SAR" }, shippingAddress: { countryCode: "SA" } });
  });
});

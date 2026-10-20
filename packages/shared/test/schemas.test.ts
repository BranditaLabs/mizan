import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import type { CanonicalOrder, CanonicalProduct, CanonicalShipment, Money } from "../src/model.js";
import {
  CanonicalOrderSchema, CanonicalProductSchema, CanonicalShipmentSchema, MoneySchema, ProductPatchSchema,
} from "../src/schemas.js";

const order: CanonicalOrder = {
  connector: "shopify",
  externalId: "gid://shopify/Order/1",
  number: "#1001",
  createdAt: "2026-10-20T10:00:00Z",
  updatedAt: "2026-10-20T10:00:00+02:00",
  currency: "EGP",
  total: { amount: "1150.00", currency: "EGP" },
  paymentMode: "partial",
  paymentStatus: "partially_paid",
  gateways: ["Cash on Delivery (COD)", "Paymob"],
  received: { amount: "200.00", currency: "EGP" },
  outstanding: { amount: "950.00", currency: "EGP" },
  cancelled: false,
  customer: { name: "سارة أحمد", phone: "01001234821" },
  shippingAddress: { line1: "12 شارع التحرير", city: "Nasr City", countryCode: "EG" },
  lines: [{ externalLineId: "l1", title: "Abaya", quantity: 1, unitPrice: { amount: "1150.00", currency: "EGP" } }],
  fulfillmentGroups: [{ externalId: "fo1", status: "OPEN", lineIds: ["l1"] }],
  tags: [],
};

describe("schemas", () => {
  it("accepts a valid canonical order and keeps it unchanged", () => {
    expect(CanonicalOrderSchema.parse(order)).toEqual(order);
  });

  it("rejects float money, bad currency and unknown enums with a clear path", () => {
    const bad = {
      ...order,
      total: { amount: 1150, currency: "EGP" },
      currency: "egp",
      paymentMode: "cash",
    };
    const result = CanonicalOrderSchema.safeParse(bad);
    expect(result.success).toBe(false);
    const paths = result.error!.issues.map((i) => i.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["total.amount", "currency", "paymentMode"]));
  });

  it("money amount must be a decimal string", () => {
    expect(MoneySchema.safeParse({ amount: "1,150.00", currency: "EGP" }).success).toBe(false);
    expect(MoneySchema.safeParse({ amount: "1150.00", currency: "EGP" }).success).toBe(true);
  });

  it("shipments and products", () => {
    const shipment: CanonicalShipment = {
      connector: "bosta", externalId: "d1", trackingNumber: "TRK1", orderRef: "o1", status: "in_transit",
      rawStatus: { code: 24, label: "In transit" }, cod: { amount: "950.00", currency: "EGP" }, updatedAt: "2026-10-20T10:00:00Z",
    };
    expect(CanonicalShipmentSchema.parse(shipment)).toEqual(shipment);
    expect(CanonicalShipmentSchema.safeParse({ ...shipment, status: "teleported" }).success).toBe(false);

    const product: CanonicalProduct = {
      connector: "shopify", externalId: "p1", title: "Abaya", status: "active", tags: [], updatedAt: "2026-10-20T10:00:00Z",
      variants: [{ externalId: "v1", price: { amount: "1150.00", currency: "EGP" }, compareAtPrice: null }],
    };
    expect(CanonicalProductSchema.parse(product)).toEqual(product);
    expect(ProductPatchSchema.safeParse({ productExternalId: "p1", inventory: [{ inventoryItemId: "i", locationId: "l", available: 1.5 }] }).success).toBe(false);
  });

  it("inferred types match the canonical interfaces", () => {
    expectTypeOf<z.infer<typeof MoneySchema>>().toEqualTypeOf<Money>();
    expectTypeOf<z.infer<typeof CanonicalOrderSchema>>().toMatchTypeOf<CanonicalOrder>();
    expectTypeOf<CanonicalOrder>().toMatchTypeOf<z.input<typeof CanonicalOrderSchema>>();
  });
});

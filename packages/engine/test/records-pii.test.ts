import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/sync/store.js";
import { withoutPersonalData } from "../src/engine/engine.js";
import { settle, setup } from "./fakes/setup.js";

/**
 * E2-8: the engine's own records keep no personal data (docs/07): an order is recorded without
 * the customer's name, phone, email or street, yet the courier still gets the full address
 * (read fresh from the store when shipping) and Mizan's projector still gets the whole order.
 */
const PERSONAL = ["Mona", "Adel", "1001234821", "100 123 4821", "mona@example.com", "Abbas El Akkad", "Floor 3", "11765"];

describe("engine records without personal data (E2-8)", () => {
  it("ingests, ships and tracks an order; nothing personal is stored, the courier gets the address", async () => {
    const store = new MemoryStore();
    const seen: string[] = [];
    const ctx = setup({ hooks: { onOrder: async (o) => { seen.push(o.customer.phone ?? ""); } } }, store);
    const o = ctx.shop.addOrder({ tags: ["mizan-confirmed"] });
    const wh = ctx.shop.webhook("orders/create", o);
    await ctx.engine.handleShopifyWebhook(wh.headers, wh.body);
    await settle(ctx.engine, store, ctx.clock);

    const delivery = [...ctx.bosta.deliveries.values()][0]!;
    expect(delivery.receiver).toMatchObject({ phone: "01001234821" });
    expect(JSON.stringify(delivery.dropOffAddress)).toContain("Abbas El Akkad");
    expect(seen[0]).toContain("4821"); // the projector gets the whole order

    const dump = JSON.stringify(await Promise.all(["order", "shipment"].map((t) => store.list(t))));
    for (const p of PERSONAL) expect(dump, p).not.toContain(p);
    const [rec] = await store.list<{ order: { shippingAddress: unknown; total: { amount: string } }; trackingNumber: string }>("order");
    expect(rec!.value.order.shippingAddress).toEqual({ line1: "", city: "Nasr City", province: "Cairo", countryCode: "EG" });
    expect(rec!.value.trackingNumber).toBe(delivery.trackingNumber);
  });

  it("keeps money, statuses, tags and lines", () => {
    const o = {
      connector: "shopify" as const, externalId: "gid://shopify/Order/1", number: "#1", createdAt: "x", updatedAt: "y", currency: "EGP",
      total: { amount: "1150.00", currency: "EGP" }, paymentMode: "cod" as const, paymentStatus: "unpaid" as const, gateways: ["COD"], cancelled: false,
      customer: { name: "Mona Adel", phone: "+201001234821", email: "mona@example.com" },
      shippingAddress: { name: "Mona", phone: "01001234821", line1: "12 Abbas", line2: "Floor 3", city: "Nasr City", zip: "11765", countryCode: "EG" },
      lines: [{ externalLineId: "L1", title: "Serum", quantity: 2, unitPrice: { amount: "550.00", currency: "EGP" } }], fulfillmentGroups: [], tags: ["vip"], raw: { big: true },
    };
    const s = withoutPersonalData(o);
    expect(s).toEqual({ ...o, raw: undefined, customer: { name: "" }, shippingAddress: { line1: "", city: "Nasr City", countryCode: "EG" } });
  });
});

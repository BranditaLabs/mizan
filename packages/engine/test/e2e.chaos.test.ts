import { describe, expect, it } from "vitest";
import { LOCATION, settle, setup } from "./fakes/setup.js";

/**
 * End to end, with both providers misbehaving on a fixed share of calls
 * (5xx, hangs, dropped connections, throttling, 429s). The engine must still
 * reach exactly the right final state: one delivery per order, one
 * fulfillment per order, COD orders marked paid once, prices in sync —
 * no duplicates, nothing lost, nothing left in the dead-letter queue.
 */
describe("end-to-end under chaos", () => {
  it.each([0.1, 0.25, 0.5])("ships, tracks and settles 25 orders with %s of calls failing", async (rate) => {
    const ctx = setup();
    const { shop, bosta, engine, store, clock } = ctx;
    shop.randomFaultRate = rate;
    bosta.randomFaultRate = rate;

    const orders = Array.from({ length: 25 }, (_, i) =>
      shop.addOrder({
        tags: ["mizan-confirmed"],
        cod: i % 5 !== 0, // every fifth order is prepaid
        city: ["Nasr City", "6th of October", "Alexandria", "المنصورة", "Zagazig"][i % 5],
        province: ["Cairo", "Giza", "Alexandria", "الدقهلية", "Sharqia"][i % 5],
        total: String(500 + i * 25) + ".00",
      }),
    );

    // Webhooks arrive — some twice, some never (polling must catch those).
    for (const [i, o] of orders.entries()) {
      if (i % 7 === 3) continue; // lost webhook
      const wh = shop.webhook("orders/create", o);
      await engine.handleShopifyWebhook(wh.headers, wh.body);
      if (i % 4 === 0) await engine.handleShopifyWebhook(wh.headers, wh.body); // duplicate delivery
    }
    await settle(engine, store, clock);
    clock.advance(5 * 60_000);
    await engine.scheduleReconcile();
    await settle(engine, store, clock);

    // Exactly one delivery per order.
    const byRef = new Map<string, number>();
    for (const d of bosta.deliveries.values()) byRef.set(d.businessReference, (byRef.get(d.businessReference) ?? 0) + 1);
    expect(byRef.size).toBe(25);
    expect([...byRef.values()].every((n) => n === 1)).toBe(true);

    // Exactly one fulfillment per order, carrying that delivery's tracking number.
    for (const o of orders) {
      const tn = [...bosta.deliveries.values()].find((d) => d.businessReference === o.id)!.trackingNumber;
      expect(shop.orders.get(o.id)!.fulfillments.map((f) => f.trackingInfo[0].number)).toEqual([tn]);
    }

    // Couriers deliver everything; some webhooks are lost, some duplicated, some arrive out of order.
    for (const [i, d] of [...bosta.deliveries.values()].entries()) {
      clock.advance(60_000);
      bosta.setState(d.trackingNumber, 21, "Picked up");
      const early = bosta.webhook(d.trackingNumber, { withLabel: true });
      clock.advance(60_000);
      bosta.setState(d.trackingNumber, 45, "Delivered");
      const late = bosta.webhook(d.trackingNumber, { withLabel: true });
      if (i % 6 === 2) continue; // both webhooks lost
      await engine.handleBostaWebhook({ token: "whsec-bosta" }, {}, late);
      await engine.handleBostaWebhook({ token: "whsec-bosta" }, {}, late); // duplicate
      await engine.handleBostaWebhook({ token: "whsec-bosta" }, {}, early); // arrives after "delivered"
    }
    await settle(engine, store, clock);
    clock.advance(5 * 60_000);
    await engine.scheduleReconcile();
    await settle(engine, store, clock);

    for (const o of orders) {
      const rec = await store.get<{ trackingNumber: string }>("order", o.id);
      const s = await store.get<{ shipment: { status: string } }>("shipment", rec!.trackingNumber);
      expect(s!.shipment.status).toBe("delivered");
      expect(shop.orders.get(o.id)!.displayFinancialStatus).toBe("PAID"); // COD marked paid; prepaid already paid
    }
    const markPaidCalls = shop.calls.filter((c) => c.op === "MizanOrderMarkPaid").length;
    expect(markPaidCalls).toBe(20); // the 20 COD orders, once each

    // Catalog sync under the same chaos.
    const p = shop.addProduct({ title: "Vitamin C serum", price: "500.00", stock: 15 });
    await engine.updateProduct({
      productExternalId: p.productId,
      variants: [{ externalId: p.variantId, price: { amount: "549.00", currency: "EGP" } }],
      inventory: [{ inventoryItemId: p.inventoryItemId, locationId: LOCATION, available: 80 }],
    });
    await settle(engine, store, clock);
    expect(shop.products.get(p.productId)!.variants[0].price).toBe("549.00");
    expect(shop.inventory.get(`${p.inventoryItemId}|${LOCATION}`)).toBe(80);

    expect(await store.jobs({ status: "dead" })).toEqual([]);
    const health = await engine.health();
    expect(health.outbox).toEqual({ pending: 0, dead: 0 });
  });
});

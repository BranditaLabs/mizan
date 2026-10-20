import { describe, expect, it } from "vitest";
import { LOCATION, settle, setup } from "./fakes/setup.js";

/**
 * End to end, with both providers misbehaving on a fixed share of calls
 * (5xx, hangs, dropped connections, throttling, 429s). The engine must still
 * reach exactly the right final state: one delivery per order, one
 * fulfillment per order, the right cash amount on every delivery for every
 * payment method (COD, card, deposit + COD, BNPL, bank transfer), cash orders
 * marked paid once, prices in sync — no duplicates, nothing lost, nothing left
 * in the dead-letter queue.
 */
const METHOD = (i: number) => (i % 8 === 5 ? "bank" : (["cod", "card", "deposit", "bnpl", "cod"] as const)[i % 5]);
describe("end-to-end under chaos", () => {
  it.each([0.1, 0.25, 0.5])("ships, tracks and settles 25 orders with %s of calls failing", async (rate) => {
    const ctx = setup();
    const { shop, bosta, engine, store, clock } = ctx;
    shop.randomFaultRate = rate;
    bosta.randomFaultRate = rate;

    const orders = Array.from({ length: 25 }, (_, i) =>
      shop.addOrder({
        tags: ["mizan-confirmed"],
        payment: METHOD(i),
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

    // Unpaid bank transfers must not have shipped. Then the transfers arrive; one webhook is lost.
    const bank = orders.filter((_, i) => METHOD(i) === "bank");
    expect(bank.length).toBeGreaterThan(0);
    for (const o of bank) expect([...bosta.deliveries.values()].some((d) => d.businessReference === o.id)).toBe(false);
    for (const [k, o] of bank.entries()) {
      clock.advance(30_000);
      shop.paid(o.id);
      if (k === 0) continue; // lost: the poll must catch it
      const wh = shop.webhook("orders/updated", shop.orders.get(o.id)!);
      await engine.handleShopifyWebhook(wh.headers, wh.body);
    }
    await settle(engine, store, clock);
    clock.advance(5 * 60_000);
    await engine.scheduleReconcile();
    await settle(engine, store, clock);

    // Exactly one delivery per order, collecting exactly what the customer still owes.
    for (const [i, o] of orders.entries()) {
      const d = [...bosta.deliveries.values()].find((x) => x.businessReference === o.id)!;
      const total = Number(o.total);
      const expected = { cod: total, card: 0, bnpl: 0, bank: 0, deposit: total - 300 }[METHOD(i)];
      expect(d.cod, `order ${i} (${METHOD(i)})`).toBe(expected);
    }
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
      expect(shop.orders.get(o.id)!.displayFinancialStatus).toBe("PAID"); // cash orders marked paid; others already paid
    }
    const markPaidCalls = shop.calls.filter((c) => c.op === "MizanOrderMarkPaid").length;
    const cashOrders = orders.filter((_, i) => METHOD(i) === "cod" || METHOD(i) === "deposit").length;
    expect(markPaidCalls).toBe(cashOrders); // once each, only for orders where the courier collected cash

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

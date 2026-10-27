import { describe, expect, it } from "vitest";
import { cashToCollect } from "../src/core/payments.js";
import { MizanEngine } from "../src/engine/engine.js";
import { settle, setupWoo } from "./fakes/setup.js";
import type { WooPayment } from "./fakes/woocommerce.js";

/**
 * WooCommerce under chaos (E5-7): the site fails a fixed share of calls (5xx, 503 and 429 with
 * Retry-After, hangs, dropped connections, maintenance pages, PHP notices, a write done but its
 * answer lost). Webhooks are lost, duplicated and late; WooCommerce disables them midway. The
 * engine must still end with every order in its current state, the right cash to collect for
 * every payment method, exactly three webhooks, and an empty dead-letter queue.
 */
const METHODS: WooPayment[] = ["cod", "card", "bank", "bnpl", "cod", "fawry", "cod"];

describe("WooCommerce end to end under chaos", () => {
  it.each([0.1, 0.25, 0.5])("ingests 28 orders correctly with %s of calls failing", async (rate) => {
    const { woo, engine, store, clock, latest } = setupWoo();
    await engine.init();
    woo.randomFaultRate = rate;
    await store.enqueue(MizanEngine.wooWebhooksJob("connect"), clock.now());
    await settle(engine, store, clock);

    const orders = Array.from({ length: 28 }, (_, i) => woo.addOrder({ payment: METHODS[i % METHODS.length]!, total: `${500 + i * 25}.00`, billingOnly: i % 6 === 0 }));
    for (const [i, o] of orders.entries()) {
      if (i % 5 === 2) continue; // lost
      const wh = woo.webhook("order.created", o);
      await engine.handleWooCommerceWebhook(wh.headers, wh.body);
      if (i % 4 === 0) await engine.handleWooCommerceWebhook(wh.headers, wh.body); // delivered twice
    }
    await settle(engine, store, clock);

    // Transfers and Fawry get paid; a refund; a cancellation. WooCommerce has meanwhile disabled the webhooks.
    woo.disableWebhooks();
    clock.advance(30_000);
    for (const o of orders.filter((x) => x.payment_method === "bacs" || x.payment_method === "fawry_pay")) woo.paid(o.id);
    const card = orders.find((x) => x.payment_method === "paymob")!;
    woo.refund(card.id, "100.00");
    const cancelled = orders.find((x) => x.payment_method === "cod")!;
    woo.setStatus(cancelled.id, "cancelled");
    clock.advance(5 * 60_000);
    await engine.scheduleReconcile();
    await store.enqueue(MizanEngine.wooWebhooksJob("recheck"), clock.now());
    await settle(engine, store, clock);
    clock.advance(5 * 60_000);
    // (chaos stays on: a failed poll retries until it gets through)
    await engine.scheduleReconcile();
    await settle(engine, store, clock);

    const seen = latest();
    expect(seen.size).toBe(28);
    for (const o of orders) {
      const got = seen.get(String(o.id))!;
      const method = o.payment_method;
      const expected = method === "cod" ? { paymentMode: "cod", paymentStatus: "unpaid" }
        : method === "paymob" ? { paymentMode: "prepaid", paymentStatus: o.id === card.id ? "partially_refunded" : "paid" }
        : method === "bacs" ? { paymentMode: "bank_transfer", paymentStatus: "paid" }
        : method === "fawry_pay" ? { paymentMode: "prepaid", paymentStatus: "paid" }
        : { paymentMode: "bnpl", paymentStatus: "paid" };
      expect(got, `order ${o.id} (${method})`).toMatchObject({ ...expected, cancelled: o.id === cancelled.id, phone: "01001234821" });
    }
    // The cash the courier would collect, from the engine's own record of each order.
    for (const o of orders) {
      const rec = await store.get<{ order: Parameters<typeof cashToCollect>[0] }>("order", String(o.id));
      const due = o.id === cancelled.id ? null : cashToCollect(rec!.order).amount;
      if (o.payment_method === "cod" && due !== null) expect(due).toBe(o.total);
      if (o.payment_method !== "cod") expect(due).toBe("0.00");
    }

    expect([...woo.webhooks.values()].map((w) => w.topic).sort()).toEqual(["order.created", "order.deleted", "order.updated"]);
    expect([...woo.webhooks.values()].every((w) => w.status === "active")).toBe(true);
    expect(Object.values(woo.injected).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(Math.floor(rate * 30)); // the chaos really happened (≈ rate × calls)
    expect(await store.jobs({ status: "dead" })).toEqual([]);
    expect((await engine.health()).outbox).toEqual({ pending: 0, dead: 0 });
  });
});

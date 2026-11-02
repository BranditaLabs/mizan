import { describe, expect, it } from "vitest";
import { MizanEngine, type ReconcileResult } from "../src/engine/engine.js";
import { settle, setup } from "./fakes/setup.js";

/**
 * E5-8: the nightly reconciliation reads every order the store created on a day and ingests the
 * ones whose webhook never arrived, exactly once, whatever the store's API does meanwhile; orders
 * of other days are left alone.
 */
function world(rate = 0) {
  const results: ReconcileResult[] = [];
  const projected: string[] = [];
  const ctx = setup({ hooks: { onReconciled: async (r) => { results.push(r); }, onOrder: async (o) => { projected.push(o.externalId); } } });
  ctx.shop.randomFaultRate = rate;
  return { ...ctx, results, projected };
}
const DAY = { day: "2026-10-22", from: "2026-10-21T21:00:00.000Z", to: "2026-10-22T21:00:00.000Z" };

describe("nightly reconciliation (E5-8)", () => {
  it.each([0, 0.1, 0.25])("ingests the day's orders whose webhook was lost, once (%s of calls failing)", async (rate) => {
    const w = world(rate);
    const inDay = (h: number) => new Date(Date.parse(DAY.from) + h * 3_600_000).toISOString();
    const received = Array.from({ length: 4 }, (_, i) => w.shop.addOrder({ createdAt: inDay(i + 1) }));
    const lost = Array.from({ length: 3 }, (_, i) => w.shop.addOrder({ createdAt: inDay(i + 10) }));
    const otherDay = w.shop.addOrder({ createdAt: "2026-10-20T10:00:00.000Z" });
    for (const o of received) { const wh = w.shop.webhook("orders/create", o); await w.engine.handleShopifyWebhook(wh.headers, wh.body); }
    await settle(w.engine, w.store, w.clock);
    expect(new Set(w.projected)).toEqual(new Set(received.map((o) => o.id)));

    await w.store.enqueue(MizanEngine.shopifyReconcileJob(DAY), w.clock.now());
    await w.store.enqueue(MizanEngine.shopifyReconcileJob(DAY), w.clock.now()); // the scheduler asks again: one job
    await settle(w.engine, w.store, w.clock);

    expect(w.results).toEqual([{ ...DAY, seen: 7, recovered: 3 }]);
    for (const o of lost) expect(w.projected.filter((id) => id === o.id)).toHaveLength(1);
    expect(w.projected).not.toContain(otherDay.id);
    expect(await w.store.jobs({ status: "dead" })).toHaveLength(0);
  });

  it("a day with every order received recovers nothing; an empty day reports zero", async () => {
    const w = world();
    const o = w.shop.addOrder({ createdAt: "2026-10-22T08:00:00.000Z" });
    const wh = w.shop.webhook("orders/create", o);
    await w.engine.handleShopifyWebhook(wh.headers, wh.body);
    await w.store.enqueue(MizanEngine.shopifyReconcileJob(DAY), w.clock.now());
    await w.store.enqueue(MizanEngine.shopifyReconcileJob({ day: "2026-10-19", from: "2026-10-18T21:00:00.000Z", to: "2026-10-19T21:00:00.000Z" }), w.clock.now());
    await settle(w.engine, w.store, w.clock);
    expect(w.results).toEqual(expect.arrayContaining([{ ...DAY, seen: 1, recovered: 0 }, expect.objectContaining({ day: "2026-10-19", seen: 0, recovered: 0 })]));
  });
});

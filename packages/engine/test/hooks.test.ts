import type { CanonicalOrder } from "@mizan/shared";
import { describe, expect, it } from "vitest";
import { settle, setup } from "./fakes/setup.js";

describe("hooks.onOrder", () => {
  it("is awaited inside the ingest job: a failing hook retries the job and blocks shipping until it succeeds", async () => {
    const seen: Array<{ order: CanonicalOrder; previous?: CanonicalOrder }> = [];
    let failures = 2;
    const ctx = setup({
      hooks: {
        onOrder: async (order, previous) => {
          if (failures-- > 0) throw new Error("platform database unavailable");
          seen.push({ order, ...(previous ? { previous } : {}) });
        },
      },
    });
    const o = ctx.shop.addOrder({ tags: ["mizan-confirmed"] });
    const wh = ctx.shop.webhook("orders/create", o);
    await ctx.engine.handleShopifyWebhook(wh.headers, wh.body);

    await ctx.engine.drain();
    expect(ctx.bosta.deliveries.size).toBe(0); // hook failed: nothing shipped, no engine record yet
    expect(await ctx.store.get("order", o.id)).toBeUndefined();

    await settle(ctx.engine, ctx.store, ctx.clock);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.order.externalId).toBe(o.id);
    expect(seen[0]!.order.raw).toBeUndefined();
    expect(ctx.bosta.deliveries.size).toBe(1);
    const [ingest] = await ctx.store.jobs({ kind: "shopify.ingestOrder" });
    expect(ingest!.attempts).toBe(3);
  });
});

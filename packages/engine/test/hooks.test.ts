import type { CanonicalOrder } from "@mizan/shared";
import { describe, expect, it } from "vitest";
import type { BostaLearned } from "../src/connectors/bosta/connector.js";
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

describe("learned state", () => {
  it("is persisted through hooks.onLearned only when it changes, and restored on a new engine", async () => {
    const saved: Array<{ provider: string; state: unknown }> = [];
    const ctx = setup({ hooks: { onLearned: async (provider, state) => { saved.push({ provider, state: structuredClone(state) }); } } });
    await ctx.engine.init();

    await ctx.engine.resolveCity("Kafr Atlantis", "c-giza");
    await ctx.engine.resolveCity("Kafr Atlantis", "c-giza"); // same alias again: no change, no write
    const bosta = saved.filter((s) => s.provider === "bosta");
    expect(bosta).toHaveLength(1);
    expect((bosta[0]!.state as { cities: Record<string, string> }).cities).toMatchObject({ "kafr atlantis": "c-giza" });

    // A full shipment flow teaches status codes (labels seen with codes): saved as they change.
    const o = ctx.shop.addOrder({ tags: ["mizan-confirmed"] });
    const wh = ctx.shop.webhook("orders/create", o);
    await ctx.engine.handleShopifyWebhook(wh.headers, wh.body);
    await settle(ctx.engine, ctx.store, ctx.clock);
    const last = saved.filter((s) => s.provider === "bosta").at(-1)!.state as BostaLearned;
    expect(Object.keys(last.codes).length).toBeGreaterThan(0);

    // A new engine given that state (as the platform does from connections.learned) starts with it, and saves nothing new.
    const again: unknown[] = [];
    const next = setup({ learned: { bosta: last }, hooks: { onLearned: async (_p, s) => { again.push(s); } } });
    await next.engine.init();
    expect(next.engine.bosta.exportLearned().cities).toMatchObject({ "kafr atlantis": "c-giza" });
    await next.engine.resolveCity("Kafr Atlantis", "c-giza");
    expect(again).toHaveLength(0);
  });

  it("a Shopify query-variant switch and the inventory compare field round-trip", () => {
    const ctx = setup();
    ctx.engine.shopify.loadLearned({ variants: { MizanOrder: 2 }, inventoryCompareField: "compareQuantity" });
    expect(ctx.engine.shopify.exportLearned()).toEqual({ variants: { MizanOrder: 2 }, inventoryCompareField: "compareQuantity" });
    ctx.engine.shopify.loadLearned({ variants: { Bad: -1 }, inventoryCompareField: "nonsense" as never });
    expect(ctx.engine.shopify.exportLearned().variants).not.toHaveProperty("Bad");
  });
});

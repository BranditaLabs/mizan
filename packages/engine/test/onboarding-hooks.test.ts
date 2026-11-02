import type { CanonicalProduct } from "@mizan/shared";
import { describe, expect, it } from "vitest";
import { MizanEngine, type AccessCheck } from "../src/index.js";
import { settle, setup } from "./fakes/setup.js";

describe("hooks.onProduct (E4-5: products land in Mizan's catalogue)", () => {
  it("receives every product from a backfill page and from a products/update webhook, without raw", async () => {
    const seen: CanonicalProduct[] = [];
    const ctx = setup({ hooks: { onProduct: async (p) => { seen.push(p); } } });
    const a = ctx.shop.addProduct({ title: "Abaya", price: "950.00", sku: "AB-1" });
    ctx.shop.addProduct({ title: "Scarf", price: "120.00" });
    await ctx.store.enqueue(MizanEngine.shopifyBackfillJob("connect-1", ctx.clock.now() - 86_400_000, ctx.clock.now()), ctx.clock.now());
    await settle(ctx.engine, ctx.store, ctx.clock);
    expect(seen.map((p) => p.title).sort()).toEqual(["Abaya", "Scarf"]);
    expect(seen.every((p) => p.raw === undefined)).toBe(true);
    expect(seen.find((p) => p.title === "Abaya")!.variants[0]).toMatchObject({ sku: "AB-1", price: { amount: "950.00" } });

    const wh = ctx.shop.webhook("products/update", ctx.shop.products.get(a.productId)!);
    await ctx.engine.handleShopifyWebhook(wh.headers, wh.body);
    await settle(ctx.engine, ctx.store, ctx.clock);
    expect(seen.filter((p) => p.title === "Abaya")).toHaveLength(2);
  });

  it("a failing hook retries the job (the catalogue never misses a product)", async () => {
    let failures = 1;
    const seen: string[] = [];
    const ctx = setup({ hooks: { onProduct: async (p) => { if (failures-- > 0) throw new Error("db down"); seen.push(p.title); } } });
    ctx.shop.addProduct({ title: "Abaya", price: "950.00" });
    await ctx.store.enqueue(MizanEngine.shopifyBackfillJob("connect-2", ctx.clock.now() - 86_400_000, ctx.clock.now()), ctx.clock.now());
    await settle(ctx.engine, ctx.store, ctx.clock);
    expect(seen).toEqual(["Abaya"]);
  });
});

describe("bosta.checkAccess", () => {
  const run = async (overrides: Parameters<typeof setup>[0] = {}, prepare?: (ctx: ReturnType<typeof setup>) => void) => {
    const results: AccessCheck[] = [];
    const ctx = setup({ ...overrides, hooks: { onAccessChecked: async (_p, r) => { results.push(r); } } });
    prepare?.(ctx);
    await ctx.store.enqueue(MizanEngine.bostaAccessCheckJob("save-1"), ctx.clock.now());
    await settle(ctx.engine, ctx.store, ctx.clock);
    return { ctx, results, jobs: await ctx.store.jobs({ kind: "bosta.checkAccess" }) };
  };

  it("accepts a working key with a harmless authenticated read", async () => {
    const { ctx, results, jobs } = await run();
    expect(results).toEqual([{ ok: true }]);
    expect(jobs[0]!.status).toBe("done");
    expect(ctx.bosta.calls.some((c) => c.path.startsWith("deliveries/search"))).toBe(true);
    expect(ctx.bosta.deliveries.size).toBe(0); // nothing created
  });

  it("reports a refused key once and ends the job (no retry storm, no dead letter)", async () => {
    const base = setup();
    const { results, jobs } = await run({ bosta: { apiKey: "wrong-key", baseUrl: base.bosta.baseUrl, webhookSecret: "whsec-bosta" } });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ ok: false, reason: "auth" });
    expect(jobs[0]!.status).toBe("done");
  });

  it("retries network trouble, then reports the key as working", async () => {
    const { ctx, results, jobs } = await run({}, (c) => c.bosta.faults.push({ fault: "500" }, { fault: "timeout" }));
    expect(results).toEqual([{ ok: true }]);
    expect(ctx.bosta.faults).toHaveLength(0); // both faults were hit and survived
    expect(jobs[0]!.status).toBe("done");
  });
});

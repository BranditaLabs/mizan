import { describe, expect, it } from "vitest";
import { settle, setup } from "./fakes/setup.js";

async function shippedOrder(ctx: ReturnType<typeof setup>, opts: Parameters<ReturnType<typeof setup>["shop"]["addOrder"]>[0] = {}) {
  const { shop, engine, store, clock } = ctx;
  const o = shop.addOrder({ tags: ["mizan-confirmed"], ...opts });
  const wh = shop.webhook("orders/create", o);
  await engine.handleShopifyWebhook(wh.headers, wh.body);
  await settle(engine, store, clock);
  const rec = await store.get<{ trackingNumber?: string }>("order", o.id);
  return { order: o, tn: rec?.trackingNumber };
}

describe("Bosta connector", () => {
  it("creates one delivery and fulfils the Shopify order with tracking", async () => {
    const ctx = setup();
    const { order, tn } = await shippedOrder(ctx);
    expect(tn).toBeTruthy();
    const d = ctx.bosta.deliveries.get(tn!)!;
    expect(d.businessReference).toBe(order.id);
    expect(d.cod).toBe(1150);
    expect(d.dropOffAddress.city).toBe("Cairo"); // "Nasr City" resolved to Bosta's Cairo
    expect(d.receiver.phone).toBe("01001234821");
    const f = ctx.shop.orders.get(order.id)!.fulfillments;
    expect(f).toHaveLength(1);
    expect(f[0].trackingInfo[0]).toMatchObject({ company: "Bosta", number: tn });
  });

  it("never creates a duplicate when Bosta's create response is lost", async () => {
    const ctx = setup();
    ctx.bosta.loseNextCreateResponses = 1; // delivery is created, but we time out
    const { tn } = await shippedOrder(ctx);
    expect(ctx.bosta.deliveries.size).toBe(1);
    expect(tn).toBe([...ctx.bosta.deliveries.keys()][0]);
    expect(ctx.events.some((e) => e.event === "shipment.created" && e.data.adopted === true)).toBe(true);
  });

  it("backs off on 429 and keeps going", async () => {
    const ctx = setup();
    ctx.bosta.faults.push({ path: "deliveries", fault: "429" }, { path: "deliveries", fault: "429" });
    const { tn } = await shippedOrder(ctx);
    expect(tn).toBeTruthy();
    expect(ctx.bosta.deliveries.size).toBe(1);
    expect(ctx.engine.bosta.bucket.snapshot.refillPerSec).toBeLessThan(5); // paced down
  });

  it("maps status from labels, learns codes, and handles code-only webhooks", async () => {
    const ctx = setup();
    const { order, tn } = await shippedOrder(ctx);
    const { bosta, engine, store, clock } = ctx;
    const post = async (withLabel = false) => {
      clock.advance(60_000);
      const r = await engine.handleBostaWebhook({ token: "whsec-bosta" }, {}, bosta.webhook(tn!, { withLabel }));
      await settle(engine, store, clock);
      return r;
    };

    bosta.setState(tn!, 21, "Picked up");
    await post();
    expect((await store.get<{ shipment: { status: string } }>("shipment", tn!))!.shipment.status).toBe("picked_up");

    bosta.setState(tn!, 41, "Delivering");
    await post();
    expect((await store.get<{ shipment: { status: string } }>("shipment", tn!))!.shipment.status).toBe("out_for_delivery");

    bosta.setState(tn!, 45, "Delivered");
    await post();
    expect((await store.get<{ shipment: { status: string } }>("shipment", tn!))!.shipment.status).toBe("delivered");
    expect(ctx.shop.orders.get(order.id)!.displayFinancialStatus).toBe("PAID"); // COD collected → marked paid
    expect(engine.bosta.exportLearned().codes["45"]).toMatchObject({ status: "delivered", confirmations: 1 });
  });

  it("does not trust an unknown status: keeps the last good one and asks for review", async () => {
    const ctx = setup();
    const { tn } = await shippedOrder(ctx);
    ctx.bosta.setState(tn!, 999, "Some brand new state");
    await ctx.engine.handleBostaWebhook({ token: "whsec-bosta" }, {}, ctx.bosta.webhook(tn!));
    await settle(ctx.engine, ctx.store, ctx.clock);
    expect((await ctx.store.get<{ shipment: { status: string } }>("shipment", tn!))!.shipment.status).toBe("pickup_requested");
    expect(ctx.events.some((e) => e.event === "shipment.needs_review")).toBe(true);
    expect(ctx.engine.drift.report().some((d) => d.kind === "unknown_status")).toBe(true);
  });

  it("adapts when Bosta changes its payload shape", async () => {
    const ctx = setup();
    const { tn } = await shippedOrder(ctx);
    ctx.bosta.shape = "flat"; // state becomes a bare number + stateValue
    ctx.bosta.setState(tn!, 45, "Delivered");
    await ctx.engine.handleBostaWebhook({ token: "whsec-bosta" }, {}, ctx.bosta.webhook(tn!));
    await settle(ctx.engine, ctx.store, ctx.clock);
    expect((await ctx.store.get<{ shipment: { status: string } }>("shipment", tn!))!.shipment.status).toBe("delivered");

    ctx.bosta.shape = "renamed"; // trackingNumber → tracking_number
    const s = await ctx.engine.bosta.getShipment(tn!);
    expect(s.trackingNumber).toBe(tn);
    expect(ctx.engine.drift.report().some((d) => d.kind === "fallback_field")).toBe(true);
  });

  it("ignores late, out-of-order and forged webhooks", async () => {
    const ctx = setup();
    const { tn } = await shippedOrder(ctx);
    ctx.bosta.setState(tn!, 45, "Delivered");
    await ctx.engine.handleBostaWebhook({ token: "whsec-bosta" }, {}, ctx.bosta.webhook(tn!));
    await settle(ctx.engine, ctx.store, ctx.clock);
    // A forged webhook claiming "returned" is re-checked against Bosta's API, which still says delivered.
    const forged = JSON.stringify({ trackingNumber: tn, state: 46, timeStamp: ctx.clock.now() + 1 });
    expect((await ctx.engine.handleBostaWebhook({ token: "wrong" }, {}, forged)).status).toBe(401);
    await ctx.engine.handleBostaWebhook({ token: "whsec-bosta" }, {}, forged);
    await settle(ctx.engine, ctx.store, ctx.clock);
    expect((await ctx.store.get<{ shipment: { status: string } }>("shipment", tn!))!.shipment.status).toBe("delivered");
  });

  it("parks unknown cities for ops, learns the answer, and replays", async () => {
    const ctx = setup();
    const o = ctx.shop.addOrder({ tags: ["mizan-confirmed"], city: "Kafr Atlantis", province: "Unknownia" });
    const wh = ctx.shop.webhook("orders/create", o);
    await ctx.engine.handleShopifyWebhook(wh.headers, wh.body);
    await settle(ctx.engine, ctx.store, ctx.clock);
    const dead = await ctx.store.jobs({ status: "dead" });
    expect(dead).toHaveLength(1);
    expect(dead[0].lastError).toMatch(/not recognised by Bosta.*Closest/);
    expect(ctx.bosta.deliveries.size).toBe(0);

    await ctx.engine.resolveCity("Kafr Atlantis", "c-sharqia", dead[0].id);
    await settle(ctx.engine, ctx.store, ctx.clock);
    expect(ctx.bosta.deliveries.size).toBe(1);
    expect([...ctx.bosta.deliveries.values()][0].dropOffAddress.city).toBe("Sharqia");

    // The next order from the same place resolves on its own.
    await shippedOrder(ctx, { city: "Kafr Atlantis", province: "Unknownia" });
    expect(ctx.bosta.deliveries.size).toBe(2);
  });

  it("catches up on missed webhooks by polling active shipments", async () => {
    const ctx = setup();
    const { tn } = await shippedOrder(ctx);
    ctx.bosta.setState(tn!, 45, "Delivered"); // webhook never arrives
    ctx.clock.advance(5 * 60_000);
    await ctx.engine.scheduleReconcile();
    await settle(ctx.engine, ctx.store, ctx.clock);
    expect((await ctx.store.get<{ shipment: { status: string } }>("shipment", tn!))!.shipment.status).toBe("delivered");
  });

  it("uses learned codes when Bosta sends a code with no label; terminal codes need repeated confirmation", async () => {
    const ctx = setup();
    const { engine, store, clock, bosta } = ctx;
    // Teach the engine: two shipments go through "Delivering"(41) and "Delivered"(45) with labels.
    const a = await shippedOrder(ctx);
    const b = await shippedOrder(ctx);
    for (const tn of [a.tn!, b.tn!]) {
      for (const [code, label] of [[41, "Delivering"], [45, "Delivered"]] as const) {
        clock.advance(60_000);
        bosta.setState(tn, code, label);
        await engine.handleBostaWebhook({ token: "whsec-bosta" }, {}, bosta.webhook(tn));
        await settle(engine, store, clock);
      }
    }
    expect(engine.bosta.exportLearned().codes["45"].confirmations).toBe(2);

    // Now labels disappear from Bosta's responses.
    bosta.shape = "codeOnly";
    const c = await shippedOrder(ctx);
    clock.advance(60_000);
    bosta.setState(c.tn!, 41, "Delivering");
    await engine.handleBostaWebhook({ token: "whsec-bosta" }, {}, bosta.webhook(c.tn!));
    await settle(engine, store, clock);
    const status = async () => (await store.get<{ shipment: { status: string } }>("shipment", c.tn!))!.shipment.status;
    expect(await status()).toBe("out_for_delivery"); // non-terminal learned code is trusted

    clock.advance(60_000);
    bosta.setState(c.tn!, 45, "Delivered");
    await engine.handleBostaWebhook({ token: "whsec-bosta" }, {}, bosta.webhook(c.tn!));
    await settle(engine, store, clock);
    expect(await status()).toBe("out_for_delivery"); // "delivered" seen with a label only twice: not trusted yet
    expect(ctx.events.some((e) => e.event === "shipment.needs_review")).toBe(true);

    // Ops confirms the code once; from then on it is applied.
    engine.bosta.statuses.setOverride(45, "delivered");
    clock.advance(60_000);
    await engine.scheduleReconcile();
    await settle(engine, store, clock);
    expect(await status()).toBe("delivered");
  });
});

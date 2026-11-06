import { describe, expect, it } from "vitest";
import { matchDistrict } from "../src/connectors/bosta/cities.js";
import { DISTRICTS } from "./fakes/bosta.js";
import { MizanEngine } from "../src/engine/engine.js";
import { BostaConnector, DEFAULT_TRACKING_URL } from "../src/connectors/bosta/connector.js";
import { ShapeWatch } from "../src/adapt/shape.js";
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
  it("links every tracking number to Bosta's public page, even with no template configured", () => {
    const ctx = setup();
    const bare = new BostaConnector({ apiKey: "k", webhookSecret: "s" }, ctx.rt, { record: () => {} }, new ShapeWatch());
    expect(DEFAULT_TRACKING_URL).toContain("{tn}");
    expect(bare.trackingUrl("12345678")).toBe("https://bosta.co/tracking-shipments?shipment-number=12345678");
  });

  it("a Shopify fulfillment made without the link gets it (once); a cancelled one is left as the merchant left it", async () => {
    const ctx = setup();
    const o = ctx.shop.addOrder({});
    const shopify = ctx.engine.shopify;
    expect(await shopify.fulfillWithTracking(o.id, { company: "Bosta", number: "777" }, false)).toBe("created");
    const url = "https://bosta.co/tracking-shipments?shipment-number=777";
    expect(await shopify.fulfillWithTracking(o.id, { company: "Bosta", number: "777", url })).toBe("link_updated");
    expect(ctx.shop.orders.get(o.id)!.fulfillments[0]!.trackingInfo[0]).toMatchObject({ number: "777", url });
    expect(await shopify.fulfillWithTracking(o.id, { company: "Bosta", number: "777", url })).toBe("already_fulfilled");
    expect(ctx.shop.trackingUpdates).toBe(1);
    // Another parcel's number on the same fulfillment: the update would drop it, so it is left alone.
    const o2 = ctx.shop.addOrder({});
    expect(await shopify.fulfillWithTracking(o2.id, { company: "Bosta", number: "888" }, false)).toBe("created");
    ctx.shop.orders.get(o2.id)!.fulfillments[0]!.trackingInfo.push({ company: "Bosta", number: "889" });
    expect(await shopify.fulfillWithTracking(o2.id, { company: "Bosta", number: "888", url })).toBe("already_fulfilled");
    expect(ctx.shop.orders.get(o2.id)!.fulfillments[0]!.trackingInfo.map((t) => t.number)).toEqual(["888", "889"]);
    ctx.shop.orders.get(o.id)!.fulfillments[0]!.status = "CANCELLED";
    expect(await shopify.fulfillWithTracking(o.id, { company: "Bosta", number: "777", url: url + "&x" })).toBe("already_fulfilled");
  });

  it("a read-back without a COD keeps what was booked (never 0), and says so as drift", async () => {
    const ctx = setup();
    ctx.bosta.omitCod = true;
    const { tn } = await shippedOrder(ctx);
    const rec = await ctx.store.get<{ shipment: { cod: { amount: string } } }>("shipment", tn!);
    expect(Number(rec!.shipment.cod.amount)).toBe(1150);
    expect(ctx.events.find((e) => e.event === "shipment.created")?.data.cod).toBe("1150");
  });

  it("the courier gets the customer's pin and email; a governorate given by its code ('C') is Cairo, and its district comes from the address", async () => {
    const ctx = setup();
    const { order } = await shippedOrder(ctx);
    const rec = await ctx.store.get<{ order: Parameters<BostaConnector["buildDeliveryPayload"]>[0] }>("order", order.id);
    const base = rec!.order;
    const o = { ...base, customer: { ...base.customer, email: "mona@example.com" }, shippingAddress: { ...base.shippingAddress!, city: "C", province: "C", line1: "5 Street", line2: "Sheraton", phone: "+201001234821", location: { lat: 30.1, lng: 31.37 } } };
    const p = await ctx.engine.bosta.buildDeliveryPayload(o, "ref-pin") as { notes: string; receiver: { email?: string }; dropOffAddress: Record<string, unknown> };
    expect(p.notes).toContain("https://www.google.com/maps?q=30.1,31.37");
    expect(p.notes.startsWith(`Mizan order ${o.number}`)).toBe(true);
    expect(p.receiver.email).toBe("mona@example.com");
    expect(p.dropOffAddress).toMatchObject({ city: "Cairo", districtId: "d-sheraton" });
  });

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

  it("names the district Bosta asks for: the area found in the city's list, or by name", async () => {
    // Bosta refuses a delivery without one: "dropOffAddress must contain at least one of [districtId, districtName]".
    const ctx = setup();
    const nasr = await shippedOrder(ctx); // "Nasr City", Cairo
    expect(ctx.bosta.deliveries.get(nasr.tn!)!.dropOffAddress).toMatchObject({ city: "Cairo", districtId: "d-nasr-1" });
    const sheraton = await shippedOrder(ctx, { city: "شيراتون", province: "Cairo" }); // Arabic, matched to "Sheraton"
    expect(ctx.bosta.deliveries.get(sheraton.tn!)!.dropOffAddress).toMatchObject({ city: "Cairo", districtId: "d-sheraton" });
    const assiut = await shippedOrder(ctx, { city: "Manfalut", province: "Assiut" }); // no list for the city: by name
    expect(ctx.bosta.deliveries.get(assiut.tn!)!.dropOffAddress).toMatchObject({ city: "Assiut", districtName: "Manfalut" });
    expect(ctx.bosta.count("GET", "cities/c-cairo/districts")).toBe(1); // a day at a time
  });

  it("matches a district by any spelling, then by a name inside it", () => {
    const cairo = DISTRICTS["c-cairo"]!.flatMap((z) => z.districts.map((d) => ({ id: d.districtId, name: d.districtName, nameAr: d.districtOtherName })));
    expect(matchDistrict(cairo, "sheraton")?.id).toBe("d-sheraton");
    expect(matchDistrict(cairo, "Sheraton Heliopolis")?.id).toBe("d-sheraton"); // another spelling in the shared list
    expect(matchDistrict(cairo, "الكوربه")?.id).toBe("d-korba");
    expect(matchDistrict(cairo, "مدينة نصر")?.id).toBe("d-nasr-1");
    expect(matchDistrict(cairo, "Zamalek")).toBeNull();
    expect(matchDistrict(cairo, "", null, "12 El Korba St")?.id).toBe("d-korba"); // the street names it
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

  it("Bosta makes the delivery, then answers 503 or drops the connection: never re-sent, still one delivery", async () => {
    for (const fault of ["503", "drop"] as const) {
      const ctx = setup();
      ctx.bosta.failAfterCreate.push(fault);
      const { tn } = await shippedOrder(ctx);
      expect(tn).toBeTruthy();
      expect(ctx.bosta.deliveries.size).toBe(1);
    }
  });

  it("a cancel whose answer is lost is read back: terminated is done, a second terminate is never needed", async () => {
    const ctx = setup({ hooks: { onShipmentCancelled: async (_id, r) => { results.push(r); } } });
    const results: Array<{ ok: boolean }> = [];
    const { tn } = await shippedOrder(ctx);
    ctx.bosta.setState(tn!, 10, "Pickup requested");
    ctx.bosta.loseNextTerminates = 1;
    await ctx.store.enqueue(MizanEngine.bostaCancelJob({ shipmentId: "s-1", trackingNumber: tn! }), ctx.clock.now());
    await settle(ctx.engine, ctx.store, ctx.clock);
    expect(ctx.bosta.deliveries.get(tn!)!.state.code).toBe(48);
    expect(results).toEqual([{ ok: true }]);
  });

  it("a delivery the courier no longer finds is said once and not polled again (no dead job every round)", async () => {
    const reviews: string[] = [];
    const ctx = setup({ hooks: { onShipmentStatus: async (u) => { if (u.needsReview) reviews.push(String((u.raw as { label?: string }).label)); } } });
    const { tn } = await shippedOrder(ctx);
    ctx.bosta.deliveries.delete(tn!); // terminated and gone at Bosta
    for (let i = 0; i < 3; i++) {
      ctx.clock.advance(6 * 60_000);
      await ctx.engine.scheduleReconcile();
      await settle(ctx.engine, ctx.store, ctx.clock);
    }
    expect(reviews).toEqual(["not found at the courier"]);
    expect(await ctx.store.jobs({ status: "dead" })).toEqual([]);
  });
});


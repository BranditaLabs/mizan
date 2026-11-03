import { describe, expect, it } from "vitest";
import { MizanEngine } from "../src/engine/engine.js";
import { editMarker, type OrderEditOutcome, type OrderEditPlan } from "../src/core/order-edit.js";
import { settle, setup, setupWoo } from "./fakes/setup.js";

/**
 * O3: an order changed before it ships reaches the store once — Shopify through an order edit
 * plus orderUpdate for the address, WooCommerce in one update — whatever the faults: a repeated
 * job, a commit or update whose answer was lost. What the store refuses is reported, not retried.
 */
const address = { name: "Mona Adel", phone: "+201001234821", line1: "5 Tahrir St", city: "Giza", province: "Giza", countryCode: "EG" };

function shopifyWorld(seed = 0, rate = 0) {
  const plans = new Map<string, OrderEditPlan>();
  const results = new Map<string, OrderEditOutcome>();
  const w = setup({ hooks: { loadOrderEdit: async (id) => plans.get(id), onOrderEditResult: async (id, r) => { results.set(id, r); } } }, undefined, seed);
  w.shop.randomFaultRate = rate;
  w.shop.addProduct({ title: "Vitamin C serum 30 ml", price: "575.00", sku: "SER-30", stock: 50 });
  const scarf = w.shop.addProduct({ title: "Matching scarf", price: "150.00", sku: "SC-1", stock: 50 });
  const run = async (plan: OrderEditPlan) => {
    plans.set(plan.editId, plan);
    await w.store.enqueue(MizanEngine.orderEditJob("shopify", plan.editId), w.clock.now());
    await settle(w.engine, w.store, w.clock);
    return results.get(plan.editId);
  };
  return { ...w, scarf, plans, results, run };
}

describe("editing a Shopify order (O3)", () => {
  it("changes quantities, adds an item, replaces the delivery fee and the address; tags the order; repeats are no-ops", async () => {
    const w = shopifyWorld();
    const o = w.shop.addOrder();
    const line = o.lines[0]!;
    const plan: OrderEditPlan = { editId: "e1", orderId: o.id, currency: "EGP", lines: [{ lineId: line.id, quantity: 1 }], add: [{ variantId: w.scarf.variantId, quantity: 1 }], shipping: "60.00", address };
    expect(await w.run(plan)).toEqual({ ok: true, outcome: "applied" });

    const after = w.shop.orders.get(o.id)!;
    expect(after.lines.map((l) => [l.sku, l.quantity])).toEqual([["SER-30", 1], ["SC-1", 1]]);
    expect(after.shippingLines.map((x) => x.price)).toEqual(["60.00"]);
    expect(after.total).toBe("785.00"); // 1150 − 575 + 150 + 60
    expect(after.shippingAddress).toMatchObject({ address1: "5 Tahrir St", city: "Giza" });
    expect(after.tags).toContain(editMarker("e1"));
    expect(w.shop.committedEdits).toBe(1);

    // The same job again (a replay), or the same edit again: nothing more.
    expect(await w.engine.shopify.editOrder(plan)).toBe("already_applied");
    expect(w.shop.committedEdits).toBe(1);
  });

  it("removes a line with quantity 0 and the fee with 0; an order already like the edit is only tagged", async () => {
    const w = shopifyWorld();
    const o = w.shop.addOrder();
    o.shippingLines.push({ id: "gid://shopify/ShippingLine/77", title: "Standard", price: "50.00" });
    o.total = "1200.00";
    const plan: OrderEditPlan = { editId: "e2", orderId: o.id, currency: "EGP", lines: [{ lineId: o.lines[0]!.id, quantity: 0 }], add: [{ variantId: w.scarf.variantId, quantity: 2 }], shipping: "0" };
    expect(await w.run(plan)).toEqual({ ok: true, outcome: "applied" });
    expect(w.shop.orders.get(o.id)!.lines.map((l) => [l.sku, l.quantity])).toEqual([["SC-1", 2]]);
    expect(w.shop.orders.get(o.id)!).toMatchObject({ shippingLines: [], total: "300.00" });

    // The marker lost (a merchant removed it): the order already has the edit, so it is not edited twice.
    w.shop.orders.get(o.id)!.tags = [];
    expect(await w.engine.shopify.editOrder(plan)).toBe("applied");
    expect(w.shop.committedEdits).toBe(1);
  });

  it("refuses a price change, a cancelled order and a missing one, once each, without editing", async () => {
    const w = shopifyWorld();
    const o = w.shop.addOrder();
    expect(await w.run({ editId: "p", orderId: o.id, currency: "EGP", lines: [{ lineId: o.lines[0]!.id, quantity: 2, unitPrice: "500.00" }], add: [] }))
      .toMatchObject({ ok: false, reason: "validation", message: expect.stringMatching(/change the price in Shopify/) });
    const gone = w.shop.addOrder();
    w.shop.orders.get(gone.id)!.cancelledAt = new Date(w.clock.now()).toISOString();
    expect(await w.run({ editId: "c", orderId: gone.id, currency: "EGP", lines: [], add: [], shipping: "10" })).toMatchObject({ ok: false, reason: "validation" });
    expect(await w.run({ editId: "n", orderId: "gid://shopify/Order/404", currency: "EGP", lines: [], add: [], shipping: "10" })).toMatchObject({ ok: false, reason: "not_found" });
    expect(w.shop.committedEdits).toBe(0);
  });

  it("a withdrawn edit sends nothing", async () => {
    const w = shopifyWorld();
    await w.store.enqueue(MizanEngine.orderEditJob("shopify", "gone"), w.clock.now());
    await settle(w.engine, w.store, w.clock);
    expect(w.results.size).toBe(0);
    expect(w.shop.count("MizanOrderEditBegin")).toBe(0);
  });

  it.each([1, 2, 3, 4, 5])("with faults on every call (seed %i) the edit lands exactly once", async (seed) => {
    const w = shopifyWorld(seed, 0.35);
    const o = w.shop.addOrder();
    const result = await w.run({ editId: `f${seed}`, orderId: o.id, currency: "EGP", lines: [{ lineId: o.lines[0]!.id, quantity: 3 }], add: [{ variantId: w.scarf.variantId, quantity: 1 }], shipping: "45.00" });
    expect(result).toEqual({ ok: true, outcome: "applied" });
    const after = w.shop.orders.get(o.id)!;
    expect(after.lines.map((l) => [l.sku, l.quantity])).toEqual([["SER-30", 3], ["SC-1", 1]]);
    expect(after.total).toBe("1920.00"); // 1150 + 575 + 150 + 45
    expect(w.shop.committedEdits).toBe(1);
  });
});

function wooWorld(seed = 0, rate = 0) {
  const plans = new Map<string, OrderEditPlan>();
  const results = new Map<string, OrderEditOutcome>();
  const w = setupWoo({ hooks: { loadOrderEdit: async (id) => plans.get(id), onOrderEditResult: async (id, r) => { results.set(id, r); } } }, undefined, seed);
  w.woo.randomFaultRate = rate;
  const abaya = w.woo.addProduct({ name: "عباية", price: "700.00", sizes: ["S", "M"] });
  const sizeM = w.woo.variationsOf.get(abaya.id)!.find((v) => v.sku.endsWith("-M"))!;
  const run = async (plan: OrderEditPlan) => {
    plans.set(plan.editId, plan);
    await w.store.enqueue(MizanEngine.orderEditJob("woocommerce", plan.editId), w.clock.now());
    await settle(w.engine, w.store, w.clock);
    return results.get(plan.editId);
  };
  return { ...w, sizeM, abaya, results, run };
}

describe("editing a WooCommerce order (O3)", () => {
  it("one update: quantity and price, a variation added, the fee and the address; written once", async () => {
    const w = wooWorld();
    const o = w.woo.addOrder({ total: "1250.00" });
    const line = o.line_items[0]!;
    const plan: OrderEditPlan = {
      editId: "w1", orderId: String(o.id), currency: "EGP",
      lines: [{ lineId: String(line.id), quantity: 1, unitPrice: "550.00" }], add: [{ variantId: String(w.sizeM.id), quantity: 1 }], shipping: "60.00", address,
    };
    expect(await w.run(plan)).toEqual({ ok: true, outcome: "applied" });
    const after = w.woo.orders.get(o.id)!;
    expect(after.line_items.map((l) => [l.product_id, l.variation_id, l.quantity, l.total])).toEqual([[501, 0, 1, "550.00"], [w.abaya.id, w.sizeM.id, 1, "700.00"]]);
    expect(after).toMatchObject({ shipping_total: "60.00", total: "1310.00", shipping: { address_1: "5 Tahrir St", city: "Giza", first_name: "Mona" } });
    expect(after.meta_data).toContainEqual(expect.objectContaining({ key: editMarker("w1"), value: "w1" }));
    // The connector directly (the engine keeps it private): the same edit again changes nothing.
    const woo = (w.engine as unknown as { wooConnector(): { editOrder(p: OrderEditPlan): Promise<string> } }).wooConnector();
    expect(await woo.editOrder(plan)).toBe("already_applied");
    expect(w.woo.orders.get(o.id)!.line_items).toHaveLength(2);
  });

  it("refuses a completed order", async () => {
    const w = wooWorld();
    const o = w.woo.addOrder();
    w.woo.orders.get(o.id)!.status = "completed";
    expect(await w.run({ editId: "w2", orderId: String(o.id), currency: "EGP", lines: [], add: [], shipping: "0" })).toMatchObject({ ok: false, reason: "validation" });
  });

  it.each([1, 2, 3, 4, 5])("with faults and lost answers (seed %i) a new item is added once", async (seed) => {
    const w = wooWorld(seed, 0.35);
    const o = w.woo.addOrder();
    const result = await w.run({ editId: `wf${seed}`, orderId: String(o.id), currency: "EGP", lines: [], add: [{ variantId: String(w.sizeM.id), quantity: 2 }] });
    expect(result).toEqual({ ok: true, outcome: "applied" });
    expect(w.woo.orders.get(o.id)!.line_items.filter((l) => l.variation_id === w.sizeM.id).map((l) => l.quantity)).toEqual([2]);
  });
});

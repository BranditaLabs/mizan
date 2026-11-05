import { describe, expect, it } from "vitest";
import type { CanonicalOrder } from "@mizan/shared";
import { MizanEngine } from "../src/engine/engine.js";
import type { StoreOrderDraft, StoreOrderOutcome } from "../src/core/store-order.js";
import { settle, setup } from "./fakes/setup.js";

/**
 * An order made in Mizan reaches Shopify once — named like Mizan's, with its lines, delivery,
 * discount, what was paid and the address — through lost answers, repeats and faults. Mizan's id
 * rides in a unique field: the store refuses a second order with it and the engine adopts the first.
 */
const OID = "3b1c2d4e-5f60-4718-8293-a4b5c6d7e8f9";
const draft = (over: Partial<StoreOrderDraft> = {}): StoreOrderDraft => ({
  orderId: OID, number: "M-1001", currency: "EGP",
  lines: [{ title: "Abaya, plain", sku: "ABY-1", quantity: 2, unitPrice: "1150.00" }],
  shipping: "50.00", discount: "100.00", paid: "300.00", financialStatus: "PARTIALLY_PAID",
  address: { firstName: "Mona", lastName: "Adel", phone: "+201001234821", line1: "12 Abbas El Akkad St", city: "Sheraton", provinceCode: "C", countryCode: "EG" },
  phone: "+201001234821", tags: ["mizan"], ...over,
});

function world(seed = 0, rate = 0) {
  const drafts = new Map<string, StoreOrderDraft>();
  const results: StoreOrderOutcome[] = [];
  const ingested: CanonicalOrder[] = [];
  const w = setup({ hooks: {
    loadStoreOrderDraft: async (id) => drafts.get(id),
    onStoreOrderCreated: async (_id, r) => { results.push(r); },
    onOrder: async (o) => { ingested.push(o); },
  } }, undefined, seed);
  w.shop.randomFaultRate = rate;
  const push = async (d: StoreOrderDraft) => {
    drafts.set(d.orderId, d);
    await w.store.enqueue(MizanEngine.shopifyCreateOrderJob(d.orderId), w.clock.now());
    await settle(w.engine, w.store, w.clock);
  };
  const copies = () => [...w.shop.orders.values()].filter((o) => o.sourceIdentifier === `mizan:${OID}`);
  return { ...w, results, ingested, push, copies };
}

describe("an order made in Mizan, created in Shopify", () => {
  it("is created once with Mizan's number, lines, delivery, discount, the deposit and the address; read back knowing it is Mizan's", async () => {
    const w = world();
    await w.push(draft());
    const [o] = w.copies();
    expect(o).toMatchObject({ name: "M-1001", total: "2250.00", received: "300.00", displayFinancialStatus: "PARTIALLY_PAID", tags: ["mizan"] });
    expect(o!.lines).toEqual([expect.objectContaining({ title: "Abaya, plain", sku: "ABY-1", quantity: 2, price: "1150.00" })]);
    expect(o!.shippingAddress).toMatchObject({ firstName: "Mona", address1: "12 Abbas El Akkad St", city: "Sheraton", province: "C", countryCodeV2: "EG" });
    expect(w.results).toEqual([{ ok: true, externalId: o!.id, name: "M-1001", outcome: "created" }]);
    expect(w.ingested.at(-1)).toMatchObject({ externalId: o!.id, mizanOrderId: OID });
  });

  it("never twice: a lost answer, a repeat, a second job — the first order is adopted", async () => {
    const w = world();
    w.shop.faults.push({ op: "MizanOrderCreate", fault: "lost" }); // created at Shopify, the answer never comes
    await w.push(draft());
    await w.push(draft()); // done already: the same key
    await w.store.enqueue({ ...MizanEngine.shopifyCreateOrderJob(OID), idempotencyKey: "another-run" }, w.clock.now());
    await settle(w.engine, w.store, w.clock);
    expect(w.copies()).toHaveLength(1);
    expect(w.shop.orderCreates).toBe(1);
    expect(w.results.every((r) => r.ok)).toBe(true);
    expect(w.results.map((r) => (r.ok ? r.outcome : r.reason))).toContain("already_created");
  });

  it("the store's unique field refuses a second order even if the first was missed: adopted, not doubled", async () => {
    const w = world();
    await w.push(draft());
    // A racing worker that read "not there" before the first create landed: Shopify refuses its create.
    w.shop.faults.push({ op: "MizanOrderByMizanId", fault: "500" });
    await w.store.enqueue({ ...MizanEngine.shopifyCreateOrderJob(OID), idempotencyKey: "race" }, w.clock.now());
    await settle(w.engine, w.store, w.clock);
    expect(w.copies()).toHaveLength(1);
  });

  it("a refusal is final and said (a variant the store no longer has); nothing is created", async () => {
    const w = world();
    await w.push(draft({ lines: [{ variantExternalId: "gid://shopify/ProductVariant/404", title: "Gone", quantity: 1, unitPrice: "10.00" }], paid: "0.00", financialStatus: "PENDING", discount: "0.00" }));
    expect(w.results[0]).toMatchObject({ ok: false, reason: "validation" });
    expect(w.copies()).toHaveLength(0);
  });

  it("chaos: at 25% faults every order is in Shopify exactly once", async () => {
    for (const seed of [1, 2, 3]) {
      const w = world(seed, 0.25);
      await w.push(draft());
      expect(w.copies()).toHaveLength(1);
      expect(w.results.some((r) => r.ok)).toBe(true);
      expect(await w.store.jobs({ status: "dead" })).toEqual([]);
    }
  });

  it("an edit reaches the copy: quantities follow; an item added at another price than the store's is refused, not re-priced", async () => {
    const synced: Array<{ ok: boolean; reason?: string }> = [];
    const drafts = new Map<string, StoreOrderDraft>();
    const w = setup({ hooks: {
      loadStoreOrderDraft: async (id) => drafts.get(id),
      onStoreOrderCreated: async () => {},
      loadStoreCopy: async (id) => { const d = drafts.get(id); const c = [...w.shop.orders.values()].find((o) => o.sourceIdentifier === `mizan:${id}`); return d && c ? { copyId: c.id, draft: d } : undefined; },
      onStoreCopySynced: async (_id, r) => { synced.push(r as { ok: boolean; reason?: string }); },
    } });
    drafts.set(OID, draft());
    await w.store.enqueue(MizanEngine.shopifyCreateOrderJob(OID), w.clock.now());
    await settle(w.engine, w.store, w.clock);
    const copy = () => [...w.shop.orders.values()].find((o) => o.sourceIdentifier === `mizan:${OID}`)!;
    drafts.set(OID, draft({ lines: [{ title: "Abaya, plain", sku: "ABY-1", quantity: 3, unitPrice: "1150.00" }] }));
    await w.store.enqueue(MizanEngine.shopifyCopyEditJob(OID, "e1"), w.clock.now());
    await settle(w.engine, w.store, w.clock);
    expect(copy().lines[0]!.quantity).toBe(3);
    expect(synced.at(-1)).toMatchObject({ ok: true });

    const product = w.shop.addProduct({ title: "Serum", price: "450.00", sku: "SER-1" });
    const variant = (product as unknown as { variants: Array<{ id: string; price: string }> }).variants?.[0] ?? [...w.shop.products.values()].at(-1)!.variants[0]!;
    drafts.set(OID, draft({ lines: [{ title: "Abaya, plain", sku: "ABY-1", quantity: 3, unitPrice: "1150.00" }, { variantExternalId: variant.id, title: "Serum", quantity: 1, unitPrice: "1.00", listPrice: variant.price }] }));
    await w.store.enqueue(MizanEngine.shopifyCopyEditJob(OID, "e2"), w.clock.now());
    await settle(w.engine, w.store, w.clock);
    expect(synced.at(-1)).toMatchObject({ ok: false, reason: "validation" });
    expect(copy().lines).toHaveLength(1);
  });
});


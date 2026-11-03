import { describe, expect, it } from "vitest";
import type { ProductPatch } from "@mizan/shared";
import { MizanEngine } from "../src/engine/engine.js";
import { mapWooProduct } from "../src/connectors/woocommerce/mapper.js";
import { settle, setup, setupWoo } from "./fakes/setup.js";

/**
 * P2: a product edited in Mizan reaches the store through the outbox — fields, prices, the
 * pictures' order and the main picture — once, with the latest values whatever order the jobs
 * run in, and through faults.
 */
const egp = (amount: string) => ({ amount, currency: "EGP" });

function shopifyWorld(seed = 0, rate = 0) {
  const w = setup({}, undefined, seed);
  w.shop.randomFaultRate = rate;
  const p = w.shop.addProduct({ title: "Abaya", price: "600.00", sku: "AB-1", stock: 10, images: 3 });
  const push = async (patch: ProductPatch) => w.store.enqueue(await MizanEngine.stageProductPatch(w.store, patch, w.clock.now()), w.clock.now());
  return { ...w, p, product: () => w.shop.products.get(p.productId)!, push };
}

describe("pushing a product to Shopify (P2)", () => {
  it("title, description, status, tags, vendor, type, prices, and the pictures in a new order with a new main one", async () => {
    const w = shopifyWorld();
    const media = w.product().media.map((m) => m.id);
    await w.push({
      productExternalId: w.p.productId, title: "Crepe abaya", descriptionHtml: "<p>Soft crepe</p>", status: "draft", tags: ["abaya", "crepe"],
      vendor: "Nile Wear", productType: "Abaya", mediaOrder: [media[2]!, media[0]!, media[1]!],
      variants: [{ externalId: w.p.variantId, price: egp("550.00"), compareAtPrice: egp("700.00") }],
    });
    await settle(w.engine, w.store, w.clock);
    const p = w.product();
    expect(p).toMatchObject({ title: "Crepe abaya", descriptionHtml: "<p>Soft crepe</p>", status: "DRAFT", tags: ["abaya", "crepe"], vendor: "Nile Wear", productType: "Abaya" });
    expect(p.media.map((m) => m.id)).toEqual([media[2], media[0], media[1]]);
    expect(p.featuredMediaId).toBe(media[2]);
    expect(p.variants[0]).toMatchObject({ price: "550.00", compareAtPrice: "700.00" });
  });

  it("jobs run out of order: the older one pushes the newer values, never back", async () => {
    const w = shopifyWorld();
    const first = await MizanEngine.stageProductPatch(w.store, { productExternalId: w.p.productId, title: "First" }, w.clock.now());
    const second = await MizanEngine.stageProductPatch(w.store, { productExternalId: w.p.productId, title: "Second" }, w.clock.now());
    await w.store.enqueue(second, w.clock.now());
    await settle(w.engine, w.store, w.clock);
    await w.store.enqueue(first, w.clock.now());
    await settle(w.engine, w.store, w.clock);
    expect(w.product().title).toBe("Second");
  });

  it("an unknown picture is refused, not retried forever", async () => {
    const w = shopifyWorld();
    await w.push({ productExternalId: w.p.productId, mediaOrder: ["gid://shopify/MediaImage/404"] });
    await settle(w.engine, w.store, w.clock);
    expect(w.shop.mediaReorders).toBe(0);
    expect(w.events.some((e) => e.event === "job.dead" || e.event === "job.failed")).toBe(true);
  });

  it.each([1, 2, 3, 4, 5])("with faults on every call (seed %i) the store ends with the edit", async (seed) => {
    const w = shopifyWorld(seed, 0.35);
    const media = w.product().media.map((m) => m.id);
    await w.push({ productExternalId: w.p.productId, title: `Edited ${seed}`, mediaOrder: [media[1]!, media[2]!, media[0]!], variants: [{ externalId: w.p.variantId, price: egp("525.00") }] });
    await settle(w.engine, w.store, w.clock);
    expect(w.product()).toMatchObject({ title: `Edited ${seed}`, featuredMediaId: media[1] });
    expect(w.product().media.map((m) => m.id)).toEqual([media[1], media[2], media[0]]);
    expect(w.product().variants[0]!.price).toBe("525.00");
  });
});

function wooWorld(seed = 0, rate = 0) {
  const w = setupWoo({}, undefined, seed);
  w.woo.randomFaultRate = rate;
  const simple = w.woo.addProduct({ name: "عباية", price: "600.00", images: 3 });
  const variable = w.woo.addProduct({ name: "قفطان", price: "800.00", sizes: ["S", "M"] });
  const push = async (patch: ProductPatch) => w.store.enqueue(await MizanEngine.stageProductPatch(w.store, patch, w.clock.now(), "woocommerce"), w.clock.now());
  return { ...w, simple, variable, push };
}

describe("pushing a product to WooCommerce (P2)", () => {
  it("name, description, status, tags, the gallery order (first = main), a sale on a simple product and a variation's price", async () => {
    const w = wooWorld();
    const images = w.simple.images.map((i) => String(i.id));
    await w.push({
      productExternalId: String(w.simple.id), title: "عباية كريب", descriptionHtml: "<p>كريب</p>", status: "archived", tags: ["abaya"],
      mediaOrder: [images[1]!, images[0]!, images[2]!], variants: [{ externalId: String(w.simple.id), price: egp("500.00"), compareAtPrice: egp("600.00") }],
    });
    const sizeM = w.woo.variationsOf.get(w.variable.id)!.find((v) => v.sku.endsWith("-M"))!;
    await w.push({ productExternalId: String(w.variable.id), variants: [{ externalId: String(sizeM.id), price: egp("750.00"), compareAtPrice: null }] });
    await settle(w.engine, w.store, w.clock);

    const p = w.woo.products.get(w.simple.id)!;
    expect(p).toMatchObject({ name: "عباية كريب", description: "<p>كريب</p>", status: "private", regular_price: "600.00", sale_price: "500.00", price: "500.00" });
    expect(p.tags.map((t) => t.name)).toEqual(["abaya"]);
    expect(p.images.map((i) => String(i.id))).toEqual([images[1], images[0], images[2]]);
    expect(w.woo.variationsOf.get(w.variable.id)!.find((v) => v.id === sizeM.id)).toMatchObject({ regular_price: "750.00", sale_price: "", price: "750.00" });
  });

  it("refuses a vendor or a type (WooCommerce has neither) without writing", async () => {
    const w = wooWorld();
    await w.push({ productExternalId: String(w.simple.id), vendor: "Nile Wear" });
    await settle(w.engine, w.store, w.clock);
    expect(w.woo.productWrites).toBe(0);
  });

  it.each([1, 2, 3, 4, 5])("with faults and lost answers (seed %i) the edit lands", async (seed) => {
    const w = wooWorld(seed, 0.35);
    await w.push({ productExternalId: String(w.simple.id), title: `Edited ${seed}`, variants: [{ externalId: String(w.simple.id), price: egp("580.00"), compareAtPrice: null }] });
    await settle(w.engine, w.store, w.clock);
    expect(w.woo.products.get(w.simple.id)!).toMatchObject({ name: `Edited ${seed}`, regular_price: "580.00", sale_price: "" });
  });
});

describe("review fixes (P2)", () => {
  it("a field set back to an earlier value is pushed again (each edit is its own job)", async () => {
    const w = shopifyWorld();
    for (const status of ["draft", "active", "draft"] as const) {
      await w.push({ productExternalId: w.p.productId, status });
      await settle(w.engine, w.store, w.clock);
      expect(w.product().status).toBe(status.toUpperCase());
    }
  });

  it("WooCommerce: tags are sent by id, the missing one created once even with faults; an archived product reads back archived", async () => {
    for (const seed of [0, 1, 2, 3]) {
      const w = wooWorld(seed, seed ? 0.35 : 0);
      await w.push({ productExternalId: String(w.simple.id), tags: ["abaya", "Crepe"], status: "archived" });
      await settle(w.engine, w.store, w.clock);
      const p = w.woo.products.get(w.simple.id)!;
      expect(p.tags.map((t) => t.name)).toEqual(["abaya", "Crepe"]);
      expect(w.woo.tagCreates).toBe(1);
      expect(p.status).toBe("private");
      const read = mapWooProduct(p as unknown as Record<string, unknown>, [], { drift: { record: () => undefined }, now: () => w.clock.now() });
      expect(read.status).toBe("archived");
    }
  });

  it("WooCommerce: reordering keeps the store's pictures Mizan does not hold, after the ordered ones", async () => {
    const w = wooWorld();
    const [a, b, c] = w.simple.images.map((i) => String(i.id));
    await w.push({ productExternalId: String(w.simple.id), mediaOrder: [c!, a!] });
    await settle(w.engine, w.store, w.clock);
    expect(w.woo.products.get(w.simple.id)!.images.map((i) => String(i.id))).toEqual([c, a, b]);
  });

  it("WooCommerce: a price changed in WordPress is put back to Mizan's, sale and all", async () => {
    const w = wooWorld();
    await w.push({ productExternalId: String(w.simple.id), variants: [{ externalId: String(w.simple.id), price: egp("500.00"), compareAtPrice: egp("600.00") }] });
    await settle(w.engine, w.store, w.clock);
    const p = w.woo.products.get(w.simple.id)!;
    Object.assign(p, { regular_price: "450.00", sale_price: "", price: "450.00" }); // the merchant, in WordPress
    w.clock.advance(10 * 60_000); // past the echo window
    await w.store.enqueue({ kind: "woocommerce.ingestProduct", connection: "woocommerce", payload: { productId: String(w.simple.id) }, idempotencyKey: "ingest:after-merchant" }, w.clock.now());
    await settle(w.engine, w.store, w.clock);
    expect(w.woo.products.get(w.simple.id)!).toMatchObject({ regular_price: "600.00", sale_price: "500.00", price: "500.00" });
  });
});

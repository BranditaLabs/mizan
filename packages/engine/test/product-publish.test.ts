import { describe, expect, it } from "vitest";
import { MizanEngine } from "../src/engine/engine.js";
import { draftHandle, type ProductDraft, type ProductPublishOutcome } from "../src/core/product-draft.js";
import { settle, setup, setupWoo } from "./fakes/setup.js";
import { mapProduct } from "../src/connectors/shopify/mapper.js";

/**
 * P3: a product made in Mizan reaches a store once — with its options, variants, prices, SKUs and
 * pictures — through repeats, lost answers and faults; the platform gets the store's ids before
 * the product is read back.
 */
const PID = "0f1e2d3c-4b5a-4968-8776-655443322110";
const kaftan = (over: Partial<ProductDraft> = {}): ProductDraft => ({
  productId: PID, title: "Linen Kaftan", handle: draftHandle("Linen Kaftan", PID), descriptionHtml: "<p>Linen</p>", status: "active",
  vendor: "Nile Wear", productType: "Kaftan", tags: ["kaftan"],
  options: [{ name: "Size", values: ["S", "M"] }, { name: "Color", values: ["Sand"] }],
  variants: [
    { variantId: "v-s", sku: "KAF-S-SAND", price: "900.00", compareAtPrice: "1100.00", options: [{ name: "Size", value: "S" }, { name: "Color", value: "Sand" }] },
    { variantId: "v-m", sku: "KAF-M-SAND", price: "950.00", options: [{ name: "Size", value: "M" }, { name: "Color", value: "Sand" }] },
  ],
  images: [{ imageId: "i-1", url: "https://api.mizan.test/media/t/p/1.webp" }, { imageId: "i-2", url: "https://api.mizan.test/media/t/p/2.webp", alt: "Back" }],
  currency: "EGP", ...over,
});
const single = (): ProductDraft => kaftan({ options: [], variants: [{ variantId: "v-1", sku: "SCF-1", price: "150.00", barcode: "6221234567890", options: [] }] });

function shopifyWorld(seed = 0, rate = 0) {
  const drafts = new Map<string, ProductDraft>();
  const results: ProductPublishOutcome[] = [];
  const ingested: string[] = [];
  const w = setup({ hooks: {
    loadProductDraft: async (id) => drafts.get(id),
    onProductPublished: async (_id, r) => { results.push(r); },
    onProduct: async (p) => { ingested.push(p.externalId); },
  } }, undefined, seed);
  w.shop.randomFaultRate = rate;
  const publish = async (d: ProductDraft, attempt = 1) => {
    drafts.set(d.productId, d);
    await w.store.enqueue(MizanEngine.productPublishJob("shopify", d.productId, attempt), w.clock.now());
    await settle(w.engine, w.store, w.clock);
  };
  const made = () => [...w.shop.products.values()].filter((p) => p.handle.startsWith("linen-kaftan-") || p.handle.startsWith("product-"));
  return { ...w, results, ingested, publish, made };
}

describe("publishing a product to Shopify (P3)", () => {
  it("creates it with options, every variant (the standalone one replaced), prices, SKUs and pictures; the ids come back first", async () => {
    const w = shopifyWorld();
    await w.publish(kaftan());
    const [p] = w.made();
    expect(p).toMatchObject({ title: "Linen Kaftan", handle: "linen-kaftan-0f1e2d3c", status: "ACTIVE", vendor: "Nile Wear", tags: ["kaftan"], options: [{ name: "Size", values: ["S", "M"] }, { name: "Color", values: ["Sand"] }] });
    expect(p!.variants.map((v) => [v.sku, v.price, v.compareAtPrice, v.options])).toEqual([
      ["KAF-S-SAND", "900.00", "1100.00", [{ name: "Size", value: "S" }, { name: "Color", value: "Sand" }]],
      ["KAF-M-SAND", "950.00", null, [{ name: "Size", value: "M" }, { name: "Color", value: "Sand" }]],
    ]);
    expect(p!.media.map((m) => m.url)).toEqual(["https://api.mizan.test/media/t/p/1.webp", "https://api.mizan.test/media/t/p/2.webp"]);
    const r = w.results[0];
    expect(r).toMatchObject({ ok: true, outcome: "created", externalId: p!.id, variants: { "v-s": p!.variants[0]!.id, "v-m": p!.variants[1]!.id }, images: { "i-1": p!.media[0]!.id, "i-2": p!.media[1]!.id } });
    expect(w.ingested).toContain(p!.id);
  });

  it("a product without options: the variant Shopify makes gets the price, SKU and barcode", async () => {
    const w = shopifyWorld();
    await w.publish(single());
    const [p] = w.made();
    expect(p!.variants).toEqual([expect.objectContaining({ sku: "SCF-1", price: "150.00", barcode: "6221234567890" })]);
    expect(w.results[0]).toMatchObject({ ok: true, variants: { "v-1": p!.variants[0]!.id } });
  });

  it("publishing again finds it by its handle: nothing made twice", async () => {
    const w = shopifyWorld();
    await w.publish(kaftan());
    await w.publish(kaftan(), 2);
    expect(w.made()).toHaveLength(1);
    expect(w.shop.creates).toBe(1);
    expect(w.results[1]).toMatchObject({ ok: true, outcome: "already_created" });
  });

  it("a withdrawn draft sends nothing", async () => {
    const w = shopifyWorld();
    await w.store.enqueue(MizanEngine.productPublishJob("shopify", "gone", 1), w.clock.now());
    await settle(w.engine, w.store, w.clock);
    expect(w.shop.creates).toBe(0);
    expect(w.results).toEqual([]);
  });

  it.each([1, 2, 3, 4, 5])("with faults and lost answers (seed %i): one product, every variant once", async (seed) => {
    const w = shopifyWorld(seed, 0.35);
    await w.publish(kaftan());
    expect(w.made()).toHaveLength(1);
    expect(w.made()[0]!.variants.map((v) => v.sku).sort()).toEqual(["KAF-M-SAND", "KAF-S-SAND"]);
    expect(w.results.at(-1)).toMatchObject({ ok: true });
  });
});

function wooWorld(seed = 0, rate = 0) {
  const drafts = new Map<string, ProductDraft>();
  const results: ProductPublishOutcome[] = [];
  const w = setupWoo({ hooks: { loadProductDraft: async (id) => drafts.get(id), onProductPublished: async (_id, r) => { results.push(r); } } }, undefined, seed);
  w.woo.randomFaultRate = rate;
  const publish = async (d: ProductDraft, attempt = 1) => {
    drafts.set(d.productId, d);
    await w.store.enqueue(MizanEngine.productPublishJob("woocommerce", d.productId, attempt), w.clock.now());
    await settle(w.engine, w.store, w.clock);
  };
  const made = () => [...w.woo.products.values()].filter((p) => p.slug.endsWith("-0f1e2d3c"));
  return { ...w, results, publish, made };
}

describe("publishing a product to WooCommerce (P3)", () => {
  it("a variable product with its attributes and variations (sale prices), tags by id and pictures", async () => {
    const w = wooWorld();
    await w.publish(kaftan());
    const [p] = w.made();
    expect(p).toMatchObject({ name: "Linen Kaftan", type: "variable", status: "publish", slug: "linen-kaftan-0f1e2d3c", tags: [{ name: "kaftan" }] });
    expect(p!.attributes.map((a) => [a.name, a.options, a.variation])).toEqual([["Size", ["S", "M"], true], ["Color", ["Sand"], true]]);
    const vs = w.woo.variationsOf.get(p!.id)!;
    expect(vs.map((v) => [v.sku, v.regular_price, v.sale_price])).toEqual([["KAF-S-SAND", "1100.00", "900.00"], ["KAF-M-SAND", "950.00", ""]]);
    expect(p!.images.map((i) => i.src)).toEqual(["https://api.mizan.test/media/t/p/1.webp", "https://api.mizan.test/media/t/p/2.webp"]);
    expect(w.results[0]).toMatchObject({ ok: true, outcome: "created", externalId: String(p!.id), variants: { "v-s": String(vs[0]!.id), "v-m": String(vs[1]!.id) }, images: { "i-1": String(p!.images[0]!.id) } });
  });

  it("a simple product carries its own price, SKU and barcode; again, it is found by its slug", async () => {
    const w = wooWorld();
    await w.publish(single());
    await w.publish(single(), 2);
    expect(w.made()).toHaveLength(1);
    expect(w.made()[0]).toMatchObject({ type: "simple", sku: "SCF-1", regular_price: "150.00", global_unique_id: "6221234567890" });
    expect(w.woo.productCreates).toBe(1);
    expect(w.results[1]).toMatchObject({ ok: true, outcome: "already_created" });
  });

  it.each([1, 2, 3, 4, 5])("with faults and lost answers (seed %i): one product, each variation once", async (seed) => {
    const w = wooWorld(seed, 0.35);
    await w.publish(kaftan());
    expect(w.made()).toHaveLength(1);
    expect(w.woo.variationsOf.get(w.made()[0]!.id)!.map((v) => v.sku).sort()).toEqual(["KAF-M-SAND", "KAF-S-SAND"]);
  });
});

describe("the store's URL name (P3)", () => {
  it("Latin letters and digits, with a piece of Mizan's id; an Arabic title gives product-…", () => {
    expect(draftHandle("Linen Kaftan — Size S", PID)).toBe("linen-kaftan-size-s-0f1e2d3c");
    expect(draftHandle("قفطان كتان", PID)).toBe("product-0f1e2d3c");
  });
});

describe("review fixes (P3)", () => {
  it("refuses a product priced in another currency than the store's, in either store, without creating anything", async () => {
    const s = shopifyWorld();
    s.shop.currency = "SAR";
    await s.publish(kaftan());
    expect(s.results[0]).toMatchObject({ ok: false, reason: "validation", message: "the store sells in SAR; this product is priced in EGP" });
    expect(s.shop.creates).toBe(0);
    const w = wooWorld();
    w.woo.currency = "AED";
    await w.publish(kaftan());
    expect(w.results[0]).toMatchObject({ ok: false, reason: "validation", message: expect.stringMatching(/AED/) });
    expect(w.woo.productCreates).toBe(0);
  });

  it("WooCommerce: a variation the store refuses (its SKU is another product's) is reported in the store's words", async () => {
    const w = wooWorld();
    w.woo.addProduct({ name: "Old", price: "100.00", sku: "KAF-M-SAND" });
    await w.publish(kaftan());
    expect(w.results.at(-1)).toMatchObject({ ok: false, reason: "validation", message: "Invalid or duplicated SKU." });
  });

  it("Shopify still processing a new picture (no URL yet): the product says nothing about its pictures, so Mizan keeps its own", () => {
    const raw = {
      id: "gid://shopify/Product/1", title: "Kaftan", status: "ACTIVE", tags: [], updatedAt: new Date().toISOString(), handle: "kaftan",
      priceRangeV2: { minVariantPrice: { currencyCode: "EGP" } }, options: [], featuredMedia: { id: "gid://shopify/MediaImage/1" },
      media: { nodes: [{ id: "gid://shopify/MediaImage/1", mediaContentType: "IMAGE", alt: null, image: null }] },
      variants: { nodes: [{ id: "gid://shopify/ProductVariant/1", sku: "K-1", title: "Default Title", price: "100.00", selectedOptions: [] }] },
    };
    const ctx = { drift: { record: () => undefined }, now: () => Date.now() };
    expect(mapProduct(raw, ctx).images).toBeUndefined();
    const ready = { ...raw, media: { nodes: [{ id: "gid://shopify/MediaImage/1", mediaContentType: "IMAGE", alt: null, image: { url: "https://cdn.shopify.com/k.jpg" } }] } };
    expect(mapProduct(ready, ctx).images).toEqual([expect.objectContaining({ externalId: "gid://shopify/MediaImage/1", url: "https://cdn.shopify.com/k.jpg" })]);
  });
});

import { describe, expect, it } from "vitest";
import { CanonicalProductSchema } from "@mizan/shared";
import { DriftMonitor } from "../src/adapt/drift.js";
import { ShapeWatch } from "../src/adapt/shape.js";
import { ShopifyConnector } from "../src/connectors/shopify/connector.js";
import { mapWooProduct } from "../src/connectors/woocommerce/mapper.js";
import { FakeClock, seeded, testRuntime } from "./fakes/clock.js";
import { FakeShopify } from "./fakes/shopify.js";
import { FakeWooCommerce } from "./fakes/woocommerce.js";

const clock = new FakeClock();

function shopify() {
  const shop = new FakeShopify(clock, seeded(3));
  const rt = testRuntime(clock, { [shop.host]: shop.handler });
  const drift = new DriftMonitor();
  const connector = new ShopifyConnector({ shop: shop.host, accessToken: "shpat_test", apiVersion: "2026-10", clientSecret: shop.secret }, rt, drift, new ShapeWatch());
  return { shop, connector, drift };
}

describe("the full product from Shopify (P1)", () => {
  it("pictures in order with the main one, options, each variant's values and picture, handle and the shop's currency", async () => {
    const { shop, connector } = shopify();
    shop.currency = "USD";
    const { productId, variantIds, mediaIds } = shop.addProductWithOptions({
      title: "Linen Abaya", price: "45.00", images: 3, featured: 1, video: true,
      options: [{ name: "Color", values: ["Black", "Sand"] }, { name: "Size", values: ["S", "M"] }],
    });
    const p = await connector.getProduct(productId);
    expect(CanonicalProductSchema.parse(p)).toBeTruthy();

    expect(p.handle).toBe("linen-abaya");
    // Pictures only (the video is left out), in the store's order; the main one is the store's featured picture.
    expect(p.images!.map((i) => i.externalId)).toEqual(mediaIds.slice(0, 3));
    expect(p.images![0]).toMatchObject({ url: expect.stringMatching(/^https:\/\/cdn\.shopify\.com\//), alt: "Linen Abaya", width: 1200, height: 1500 });
    expect(p.mainImageId).toBe(mediaIds[1]);
    expect(p.options).toEqual([{ name: "Color", values: ["Black", "Sand"] }, { name: "Size", values: ["S", "M"] }]);

    expect(p.variants.map((v) => v.externalId)).toEqual(variantIds);
    expect(p.variants[0]).toMatchObject({ options: [{ name: "Color", value: "Black" }, { name: "Size", value: "S" }], imageId: mediaIds[0] });
    expect(p.variants[3]).toMatchObject({ options: [{ name: "Color", value: "Sand" }, { name: "Size", value: "M" }], imageId: mediaIds[1] });
    // Prices were labelled with the Mizan store's currency before (seen on staging: a USD shop shown in EGP).
    expect(p.variants[0]!.price).toEqual({ amount: "45.00", currency: "USD" });
  });

  it("a product without options has none (Shopify's \"Title: Default Title\" is not an option) and no main picture without pictures", async () => {
    const { shop, connector } = shopify();
    const { productId } = shop.addProduct({ title: "Serum", price: "575.00" });
    const p = await connector.getProduct(productId);
    expect(p.options).toBeUndefined();
    expect(p.images).toEqual([]); // known to have none (all removed in the store), not "unknown"
    expect(p.mainImageId).toBeUndefined();
    expect(p.variants[0]!.options).toBeUndefined();
  });

  it("an API version without these fields falls back to the older query: the product still arrives, recorded as drift", async () => {
    const { shop, connector, drift } = shopify();
    shop.rejectFields.add("featuredMedia");
    const { productId } = shop.addProduct({ title: "Serum", price: "575.00", images: 2 });
    const p = await connector.getProduct(productId);
    expect(p.title).toBe("Serum");
    expect(drift.report().some((d) => d.kind === "fallback_field" && d.entity === "MizanProduct")).toBe(true);
  });
});

describe("the full product from WooCommerce (P1)", () => {
  it("the gallery's first picture is the main one; variation attributes become options; each variation keeps its picture", () => {
    const woo = new FakeWooCommerce(clock);
    const raw = woo.addProduct({ sizes: ["S", "M", "L"], images: 2 });
    const p = mapWooProduct(raw, woo.variationsOf.get(raw.id)!, { drift: new DriftMonitor(), now: () => clock.now() });
    expect(p.handle).toBe(`abaya-${raw.id}`);
    expect(p.images!.map((i) => i.externalId)).toEqual(raw.images.map((i) => String(i.id)));
    expect(p.mainImageId).toBe(String(raw.images[0]!.id));
    // Only the attributes variations differ by ("Fabric" describes the product, it is not an option).
    expect(p.options).toEqual([{ name: "Size", values: ["S", "M", "L"] }]);
    expect(p.variants.map((v) => v.options)).toEqual([[{ name: "Size", value: "S" }], [{ name: "Size", value: "M" }], [{ name: "Size", value: "L" }]]);
    expect(p.variants.map((v) => v.imageId)).toEqual([String(raw.images[0]!.id), String(raw.images[1]!.id), undefined]); // id 0: no picture
  });

  it("a simple product: its pictures, no options", () => {
    const woo = new FakeWooCommerce(clock);
    const raw = woo.addProduct({ images: 1 });
    const p = mapWooProduct(raw, [], { drift: new DriftMonitor(), now: () => clock.now() });
    expect(p.images).toHaveLength(1);
    expect(p.options).toBeUndefined();
  });
});

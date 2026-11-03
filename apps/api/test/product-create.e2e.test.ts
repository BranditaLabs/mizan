import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import type { CanonicalProduct } from "@mizan/shared";
import sharp from "sharp";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { ProductProjector } from "../src/modules/catalog/product-projector.js";
import { ProductBuilderService } from "../src/modules/catalog/product-builder.service.js";
import { ConnectionLifecycle } from "../src/integrations/connection-lifecycle.js";
import { FakeVerifier } from "./support/fake-auth.js";

/** P3: products made in Mizan — created, pictures uploaded and served, published to a store and linked to it. */
const fake = new FakeVerifier();
let app: INestApplication;
let db: Database;
let store: string;
let shopify: string;
const http = () => request(app.getHttpServer());
const as = (token: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", "X-Tenant-Id": store });
const png = (w = 800, h = 600) => sharp({ create: { width: w, height: h, channels: 3, background: "#b00020" } }).png().toBuffer();
const KAFTAN = {
  title: "Linen Kaftan", description: "Linen.\n\nHand made.", status: "active", vendor: "Nile Wear", tags: ["kaftan"],
  options: [{ name: "Size", values: ["S", "M"] }],
  variants: [
    { options: [{ name: "Size", value: "S" }], sku: "KAF-S", price: "900", compareAtPrice: "1100", cost: "400", barcode: "6221234500011" },
    { options: [{ name: "Size", value: "M" }], sku: "KAF-M", price: "950" },
  ],
};

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test", MEDIA_MAX_BYTES: "2000000" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  db = app.get(Database);
  fake.add("owner", { uid: "fb-owner-p3", email: "owner@p3.test", emailVerified: true, secondFactor: "phone" });
  store = (await http().post("/v1/tenants").set({ Authorization: "Bearer owner" }).send({ name: "Nile Abayas", country: "EG" }).expect(201)).body.id;
  shopify = await db.tenant(store, async (trx) => (await trx.insertInto("connections").values({ tenant_id: store, kind: "store", provider: "shopify", external_account: "nile.myshopify.com", status: "active" }).returning("id").executeTakeFirstOrThrow()).id);
});
afterAll(() => app.close());

describe("products made in Mizan (P3)", () => {
  it("creates a product with options and variants: prices, compare-at, cost, barcode; SKUs stay unique", async () => {
    const { id } = (await http().post("/v1/products").set(as("owner")).send(KAFTAN).expect(201)).body;
    const p = (await http().get(`/v1/products/${id}`).set(as("owner")).expect(200)).body;
    expect(p).toMatchObject({ title: "Linen Kaftan", status: "active", store: null, publish: null, description: "Linen.\n\nHand made.", options: [{ name: "Size", values: ["S", "M"] }] });
    expect(p.variants.map((v: { sku: string; price: { amount: string }; compareAt: { amount: string } | null; cost: { amount: string } | null; barcode: string | null }) =>
      [v.sku, v.price.amount, v.compareAt?.amount ?? null, v.cost?.amount ?? null, v.barcode])).toEqual([["KAF-S", "900.00", "1100.00", "400.00", "6221234500011"], ["KAF-M", "950.00", null, null, null]]);

    const code = async (body: object, status: number) => (await http().post("/v1/products").set(as("owner")).send(body).expect(status)).body.code;
    expect(await code(KAFTAN, 409)).toBe("sku_taken");
    expect(await code({ ...KAFTAN, variants: [{ ...KAFTAN.variants[0], sku: "X-1", barcode: undefined }, { ...KAFTAN.variants[1], sku: "X-2", options: [{ name: "Size", value: "S" }] }] }, 422)).toBe("variants_invalid");
    expect(await code({ ...KAFTAN, variants: [{ ...KAFTAN.variants[1], sku: "X-3", options: [{ name: "Size", value: "XL" }] }] }, 422)).toBe("variants_invalid");
    expect(await code({ title: "Scarf", options: [], variants: [{ sku: "SCF-1", price: "150" }, { sku: "SCF-2", price: "150" }] }, 422)).toBe("variants_invalid");
    expect(await code({ title: "Scarf", variants: [{ sku: "SCF-1", price: "150.125" }] }, 422)).toBe("price_decimals");
    await http().post("/v1/products").set(as("owner")).send({ title: "Scarf", variants: [{ sku: "SCF-1", price: "150" }] }).expect(201);
  });

  it("pictures: checked, re-encoded as WebP without metadata, a thumbnail, served publicly; the first is the main one", async () => {
    const { id } = (await http().post("/v1/products").set(as("owner")).send({ title: "Belt", variants: [{ sku: "BLT-1", price: "90" }] }).expect(201)).body;
    const up = (bytes: Buffer, type = "image/png") => http().post(`/v1/products/${id}/images`).set({ ...as("owner"), "Content-Type": type }).send(bytes);
    // A JPEG carrying GPS: the copy kept has no metadata at all.
    const withGps = await sharp({ create: { width: 1200, height: 900, channels: 3, background: "#123456" } }).jpeg()
      .withExif({ IFD0: { Make: "Phone" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "30/1 3/1 0/1" } }).toBuffer();
    const first = (await up(withGps, "image/jpeg").expect(201)).body;
    expect(first).toMatchObject({ isMain: true, width: 1200, height: 900 });
    expect(first.url).toMatch(new RegExp(`^https://api\\.mizan\\.test/media/${store}/p/${id}/[0-9a-f-]{36}\\.webp$`));
    expect(first.thumbUrl).toBe(first.url.replace(/\.webp$/, "_400.webp"));

    const served = await http().get(new URL(first.url).pathname).expect(200);
    expect(served.headers).toMatchObject({ "content-type": "image/webp", "cache-control": "public, max-age=31536000, immutable", "cross-origin-resource-policy": "cross-origin" });
    const meta = await sharp(served.body as Buffer).metadata();
    expect(meta).toMatchObject({ format: "webp", width: 1200, height: 900 });
    expect(meta.exif).toBeUndefined();
    expect((await sharp((await http().get(new URL(first.thumbUrl).pathname).expect(200)).body as Buffer).metadata()).width).toBe(400);

    const second = (await up(await png()).expect(201)).body;
    expect(second.isMain).toBe(false);
    expect((await up(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"), "image/svg+xml").expect(415)).body.code).toBe("picture_type");
    expect((await up(Buffer.from("not a picture at all"), "image/png").expect(415)).body.code).toBe("picture_type");
    expect((await up(await png(100, 100)).expect(422)).body.code).toBe("picture_too_small");
    expect((await up(Buffer.concat([await png(), Buffer.alloc(2_100_000)])).expect(413)).body.code).toBe("payload_too_large");
    await http().get(`/media/${store}/p/${id}/00000000-0000-4000-8000-000000000000.webp`).expect(404);
    await http().get(`/media/${store}/p/${id}/..%2F..%2Fsecret.webp`).expect(404);

    // Removing the main picture makes the next one main; its files go.
    await http().delete(`/v1/products/${id}/images/${first.id}`).set(as("owner")).expect(204);
    const after = (await http().get(`/v1/products/${id}`).set(as("owner")).expect(200)).body;
    expect(after.images.map((i: { id: string; isMain: boolean }) => [i.id, i.isMain])).toEqual([[second.id, true]]);
    await http().get(new URL(first.url).pathname).expect(404);
  });

  it("publishes to a store through the outbox; once the store has it, the product is linked and the store's copy updates it (no second product)", async () => {
    const { id } = (await http().post("/v1/products").set(as("owner")).send({ ...KAFTAN, variants: KAFTAN.variants.map((v) => ({ ...v, sku: `P-${v.sku}`, barcode: undefined })) }).expect(201)).body;
    const pic = (await http().post(`/v1/products/${id}/images`).set({ ...as("owner"), "Content-Type": "image/png" }).send(await png()).expect(201)).body;
    await http().post(`/v1/products/${id}/publish`).set(as("owner")).send({ connectionId: shopify }).expect(202);
    expect((await http().post(`/v1/products/${id}/publish`).set(as("owner")).send({ connectionId: shopify }).expect(409)).body.code).toBe("publishing");
    const jobs = await db.tenant(store, (trx) => trx.selectFrom("mz_outbox").select(["kind", "payload", "connection_id"]).where("kind", "=", "shopify.createProduct").execute());
    expect(jobs).toEqual([{ kind: "shopify.createProduct", connection_id: shopify, payload: { productId: id } }]);
    expect((await http().get(`/v1/products/${id}`).set(as("owner")).expect(200)).body.publish).toEqual({ status: "publishing", connectionId: shopify, error: null, onlineStore: null });

    const builder = app.get(ProductBuilderService);
    const draft = await builder.loadDraft(store, id);
    expect(draft).toMatchObject({
      productId: id, title: "Linen Kaftan", handle: `linen-kaftan-${id.replace(/-/g, "").slice(0, 8)}`, descriptionHtml: "<p>Linen.</p><p>Hand made.</p>", status: "active", currency: "EGP",
      options: [{ name: "Size", values: ["S", "M"] }], images: [{ imageId: pic.id, url: pic.url }],
      variants: [{ sku: "P-KAF-S", price: "900.00", compareAtPrice: "1100.00", options: [{ name: "Size", value: "S" }] }, { sku: "P-KAF-M", price: "950.00" }],
    });

    const [vs, vm] = draft!.variants;
    await builder.recordPublished(store, id, { ok: true, outcome: "created", externalId: "gid://shopify/Product/900", variants: { [vs!.variantId]: "gid://shopify/ProductVariant/901", [vm!.variantId]: "gid://shopify/ProductVariant/902" }, images: { [pic.id]: "gid://shopify/MediaImage/903" }, onlineStore: true });
    expect(await builder.loadDraft(store, id)).toBeUndefined();
    // The store's copy, read back: the same product, variants and picture, now on the store's CDN.
    const fromStore: CanonicalProduct = {
      connector: "shopify", externalId: "gid://shopify/Product/900", title: "Linen Kaftan", status: "active", tags: ["kaftan"], updatedAt: new Date().toISOString(),
      images: [{ externalId: "gid://shopify/MediaImage/903", url: "https://cdn.shopify.com/s/files/1/kaftan.webp" }], mainImageId: "gid://shopify/MediaImage/903",
      options: [{ name: "Size", values: ["S", "M"] }],
      variants: [
        { externalId: "gid://shopify/ProductVariant/901", sku: "P-KAF-S", title: "S", price: { amount: "900.00", currency: "EGP" }, compareAtPrice: { amount: "1100.00", currency: "EGP" }, options: [{ name: "Size", value: "S" }] },
        { externalId: "gid://shopify/ProductVariant/902", sku: "P-KAF-M", title: "M", price: { amount: "950.00", currency: "EGP" }, options: [{ name: "Size", value: "M" }] },
      ],
    };
    await app.get(ProductProjector).project(store, shopify, fromStore);
    const p = (await http().get(`/v1/products/${id}`).set(as("owner")).expect(200)).body;
    expect(p).toMatchObject({ store: { connectionId: shopify, provider: "shopify" }, publish: { status: "published" } });
    expect(p.images).toEqual([expect.objectContaining({ id: pic.id, url: "https://cdn.shopify.com/s/files/1/kaftan.webp", isMain: true })]);
    expect(p.variants.map((v: { sku: string }) => v.sku)).toEqual(["P-KAF-S", "P-KAF-M"]);
    const count = await db.tenant(store, (trx) => trx.selectFrom("products").select("id").where("title", "=", "Linen Kaftan").execute());
    expect(count).toHaveLength(2); // the first test's and this one: no third made by the store's copy
    expect((await http().post(`/v1/products/${id}/images`).set({ ...as("owner"), "Content-Type": "image/png" }).send(await png()).expect(409)).body.code).toBe("store_product");
  });

  it("a refusal is kept with the store's words, and it can be published again", async () => {
    const { id } = (await http().post("/v1/products").set(as("owner")).send({ title: "Bag", variants: [{ sku: "BAG-1", price: "300" }] }).expect(201)).body;
    await http().post(`/v1/products/${id}/publish`).set(as("owner")).send({ connectionId: shopify }).expect(202);
    await app.get(ProductBuilderService).recordPublished(store, id, { ok: false, reason: "validation", message: "Handle has already been taken" });
    expect((await http().get(`/v1/products/${id}`).set(as("owner")).expect(200)).body.publish).toEqual({ status: "failed", connectionId: shopify, error: "Handle has already been taken", onlineStore: null });
    await http().post(`/v1/products/${id}/publish`).set(as("owner")).send({ connectionId: shopify }).expect(202);
    const keys = await db.tenant(store, (trx) => trx.selectFrom("mz_outbox").select("idempotency_key").where("kind", "=", "shopify.createProduct").where(({ eb }) => eb("payload", "=", JSON.stringify({ productId: id }) as never)).execute());
    expect(keys.map((k) => k.idempotency_key).sort()).toEqual([`shopify:publish:${id}:1`, `shopify:publish:${id}:2`]);
  });

  it("the store's copy arriving before the link adopts the product being published: one product, its variants and picture kept", async () => {
    const { id } = (await http().post("/v1/products").set(as("owner")).send({ title: "Wool Shawl", options: [{ name: "Color", values: ["Grey"] }], variants: [{ options: [{ name: "Color", value: "Grey" }], sku: "SHW-G", price: "400" }] }).expect(201)).body;
    const pic = (await http().post(`/v1/products/${id}/images`).set({ ...as("owner"), "Content-Type": "image/png" }).send(await png()).expect(201)).body;
    // Renamed before publishing: the store's handle is still the one made with the product.
    await http().patch(`/v1/products/${id}`).set(as("owner")).send({ title: "Wool Shawl, grey" }).expect(200);
    await http().post(`/v1/products/${id}/publish`).set(as("owner")).send({ connectionId: shopify }).expect(202);
    const builder = app.get(ProductBuilderService);
    const draft = (await builder.loadDraft(store, id))!;
    expect(draft.handle).toBe(`wool-shawl-${id.replace(/-/g, "").slice(0, 8)}`);
    // Nothing changes while it is on its way.
    expect((await http().patch(`/v1/products/${id}`).set(as("owner")).send({ title: "x" }).expect(409)).body.code).toBe("publishing");
    expect((await http().post(`/v1/products/${id}/images`).set({ ...as("owner"), "Content-Type": "image/png" }).send(await png()).expect(409)).body.code).toBe("publishing");

    // The store's webhook comes first: its copy has the same handle.
    await app.get(ProductProjector).project(store, shopify, {
      connector: "shopify", externalId: "gid://shopify/Product/950", title: "Wool Shawl, grey", handle: draft.handle, status: "active", tags: [], updatedAt: new Date().toISOString(),
      images: [{ externalId: "gid://shopify/MediaImage/951", url: "https://cdn.shopify.com/s/files/1/shawl.webp" }], mainImageId: "gid://shopify/MediaImage/951",
      options: [{ name: "Color", values: ["Grey"] }],
      variants: [{ externalId: "gid://shopify/ProductVariant/952", sku: "SHW-G", title: "Grey", price: { amount: "400.00", currency: "EGP" }, options: [{ name: "Color", value: "Grey" }] }],
    });
    // The publish job still finishes (its draft is still there) and links the rest.
    expect(await builder.loadDraft(store, id)).toBeDefined();
    await builder.recordPublished(store, id, { ok: true, outcome: "already_created", externalId: "gid://shopify/Product/950", variants: { [draft.variants[0]!.variantId]: "gid://shopify/ProductVariant/952" }, images: { [pic.id]: "gid://shopify/MediaImage/951" }, onlineStore: true });
    const rows = await db.tenant(store, (trx) => trx.selectFrom("products").select(["id", "external_id"]).where("external_id", "=", "gid://shopify/Product/950").execute());
    expect(rows).toEqual([{ id, external_id: "gid://shopify/Product/950" }]);
    const p = (await http().get(`/v1/products/${id}`).set(as("owner")).expect(200)).body;
    expect(p).toMatchObject({ publish: { status: "published" }, variants: [{ id: draft.variants[0]!.variantId, sku: "SHW-G" }] });
    expect(p.images).toEqual([expect.objectContaining({ id: pic.id, url: "https://cdn.shopify.com/s/files/1/shawl.webp", isMain: true })]);
  });

  it("an image body sent to any other route stops at the normal limit; a store disconnected mid-publish fails the publish", async () => {
    const big = Buffer.concat([await png(), Buffer.alloc(1_100_000)]);
    expect((await http().post("/v1/orders").set({ ...as("owner"), "Content-Type": "image/png" }).send(big).expect(413)).body.code).toBe("payload_too_large");

    const { id } = (await http().post("/v1/products").set(as("owner")).send({ title: "Cap", variants: [{ sku: "CAP-1", price: "120" }] }).expect(201)).body;
    await http().post(`/v1/products/${id}/publish`).set(as("owner")).send({ connectionId: shopify }).expect(202);
    await app.get(ConnectionLifecycle).providerRevoked(store, shopify, "app_uninstalled");
    expect((await http().get(`/v1/products/${id}`).set(as("owner")).expect(200)).body.publish).toMatchObject({ status: "failed", error: expect.stringMatching(/disconnected/) });
  });
});


import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import type { CanonicalProduct } from "@mizan/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { ProductProjector } from "../src/modules/catalog/product-projector.js";
import { textToHtml } from "../src/modules/catalog/products.service.js";
import { FakeVerifier } from "./support/fake-auth.js";

/** P2: PATCH /v1/products/{id} — saved here at once, pushed to the store through the outbox, audited. */
const fake = new FakeVerifier();
let app: INestApplication;
let db: Database;
let store: string;
let shopify: string;
let woo: string;
const http = () => request(app.getHttpServer());
const as = (token: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", "X-Tenant-Id": store });
const at = new Date().toISOString();
const img = (n: number) => ({ externalId: `gid://shopify/MediaImage/${n}`, url: `https://cdn.shopify.com/s/files/1/abaya-${n}.jpg` });
const shopifyProduct: CanonicalProduct = {
  connector: "shopify", externalId: "gid://shopify/Product/1", title: "Abaya", status: "active", tags: ["abaya"], updatedAt: at, vendor: "Nile Wear", productType: "Abaya",
  images: [img(1), img(2), img(3)], mainImageId: img(1).externalId,
  variants: [{ externalId: "gid://shopify/ProductVariant/11", sku: "ABY-1", title: "Default Title", price: { amount: "1150.00", currency: "EGP" } }],
};
const wooProduct: CanonicalProduct = {
  connector: "woocommerce", externalId: "77", title: "قفطان", status: "active", tags: [], updatedAt: at,
  variants: [{ externalId: "77", sku: "KAF-1", title: "Default", price: { amount: "800.00", currency: "EGP" } }],
};
const productId = (externalId: string) => db.tenant(store, (trx) => trx.selectFrom("products").select("id").where("external_id", "=", externalId).executeTakeFirstOrThrow()).then((r) => r.id);
const outbox = (kind: string) => db.tenant(store, (trx) => trx.selectFrom("mz_outbox").select(["kind", "payload", "connection_id"]).where("kind", "=", kind).execute());

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  db = app.get(Database);
  fake.add("owner", { uid: "fb-owner-p2", email: "owner@p2.test", emailVerified: true, secondFactor: "phone" });
  store = (await http().post("/v1/tenants").set({ Authorization: "Bearer owner" }).send({ name: "Nile Abayas", country: "EG" }).expect(201)).body.id;
  [shopify, woo] = await db.tenant(store, async (trx) => [
    (await trx.insertInto("connections").values({ tenant_id: store, kind: "store", provider: "shopify", external_account: "nile.myshopify.com" }).returning("id").executeTakeFirstOrThrow()).id,
    (await trx.insertInto("connections").values({ tenant_id: store, kind: "store", provider: "woocommerce", external_account: "https://nile.example" }).returning("id").executeTakeFirstOrThrow()).id,
  ]);
  await app.get(ProductProjector).project(store, shopify, shopifyProduct);
  await app.get(ProductProjector).project(store, woo, wooProduct);
  const inv = await http().post("/v1/members/invite").set(as("owner")).send({ phone: "01201117777", role: "finance" }).expect(201);
  fake.add("finance", { uid: "fb-finance-p2", phone: inv.body.phone });
  await http().post(`/v1/invitations/${inv.body.id}/accept`).set({ Authorization: "Bearer finance" }).expect(200);
});
afterAll(() => app.close());

describe("editing a product (P2)", () => {
  it("saves every field here and stages one push to Shopify with the store's ids; audited", async () => {
    const id = await productId("gid://shopify/Product/1");
    const before = (await http().get(`/v1/products/${id}`).set(as("owner")).expect(200)).body;
    const [a, b, c] = before.images.map((i: { id: string }) => i.id);
    const variant = before.variants[0].id;
    const res = await http().patch(`/v1/products/${id}`).set(as("owner")).send({
      title: "Crepe abaya", description: "Soft crepe.\n\nMachine wash <cold>", status: "draft", tags: ["abaya", "crepe", "abaya"],
      vendor: "Nile", productType: "Robe", images: { order: [a, b, c], main: c }, variants: [{ id: variant, price: "990", compareAtPrice: "1150" }],
    }).expect(200);
    expect(res.body).toMatchObject({
      title: "Crepe abaya", status: "draft", tags: ["abaya", "crepe"], vendor: "Nile", productType: "Robe", description: "Soft crepe.\n\nMachine wash <cold>",
      variants: [{ id: variant, price: { amount: "990.00" } }],
    });
    expect(res.body.images.map((i: { id: string; isMain: boolean }) => [i.id, i.isMain])).toEqual([[c, true], [a, false], [b, false]]);

    const jobs = await outbox("shopify.pushProduct");
    expect(jobs).toEqual([{ kind: "shopify.pushProduct", connection_id: shopify, payload: { patch: {
      productExternalId: "gid://shopify/Product/1", title: "Crepe abaya", descriptionHtml: "<p>Soft crepe.</p><p>Machine wash &lt;cold&gt;</p>", status: "draft", tags: ["abaya", "crepe"],
      vendor: "Nile", productType: "Robe", mediaOrder: [img(3).externalId, img(1).externalId, img(2).externalId],
      variants: [{ externalId: "gid://shopify/ProductVariant/11", price: { amount: "990.00", currency: "EGP" }, compareAtPrice: { amount: "1150.00", currency: "EGP" } }],
    } } }]);
    const audit = await db.tenant(store, (trx) => trx.selectFrom("audit_log").select(["before", "after"]).where("action", "=", "catalog.product_updated").execute());
    expect(audit[0]!.after).toMatchObject({ changed: expect.arrayContaining(["title", "images", "variants"]), store: "shopify", variants: [{ id: variant, price: "990.00", compareAtPrice: "1150.00" }] });
    expect(audit[0]!.before).toMatchObject({ variants: [{ id: variant, price: "1150.00", compareAtPrice: null }] });
  });

  it("WooCommerce: refuses a vendor or type; pushes the rest with both prices to its own connection", async () => {
    const id = await productId("77");
    expect((await http().patch(`/v1/products/${id}`).set(as("owner")).send({ vendor: "Nile" }).expect(422)).body.code).toBe("field_not_in_store");
    const variant = (await http().get(`/v1/products/${id}`).set(as("owner")).expect(200)).body.variants[0].id;
    await http().patch(`/v1/products/${id}`).set(as("owner")).send({ title: "قفطان كريب", variants: [{ id: variant, price: "750" }] }).expect(200);
    const jobs = await outbox("woocommerce.pushProduct");
    expect(jobs).toEqual([{ kind: "woocommerce.pushProduct", connection_id: woo, payload: { patch: {
      productExternalId: "77", title: "قفطان كريب", variants: [{ externalId: "77", price: { amount: "750.00", currency: "EGP" }, compareAtPrice: null }],
    } } }]);
  });

  it("refuses what does not fit: pictures not the product's set, a compare-at not above the price, another product's variant, finance, nothing", async () => {
    const id = await productId("gid://shopify/Product/1");
    const p = (await http().get(`/v1/products/${id}`).set(as("owner")).expect(200)).body;
    const ids = p.images.map((i: { id: string }) => i.id);
    const code = async (body: object, status: number, token = "owner") => (await http().patch(`/v1/products/${id}`).set(as(token)).send(body).expect(status)).body.code;
    expect(await code({ images: { order: ids.slice(0, 2) } }, 422)).toBe("images_mismatch");
    expect(await code({ images: { order: [ids[0], ids[0], ids[1]] } }, 422)).toBe("images_mismatch");
    expect(await code({ variants: [{ id: p.variants[0].id, price: "1000", compareAtPrice: "1000" }] }, 422)).toBe("compare_at_low");
    expect(await code({ variants: [{ id: p.variants[0].id, price: "990.125" }] }, 422)).toBe("price_decimals"); // EGP has 2
    const other = (await http().get(`/v1/products/${await productId("77")}`).set(as("owner")).expect(200)).body.variants[0].id;
    expect(await code({ variants: [{ id: other, price: "10" }] }, 422)).toBe("unknown_variant");
    await code({ title: "x" }, 403, "finance");
    expect(await code({}, 422)).toBe("validation_failed");
  });

  it("text becomes the store's HTML: paragraphs, line breaks, escaped", () => {
    expect(textToHtml("One\nline two\r\n\r\n  Two & <b>  \n\n\n")).toBe("<p>One<br>line two</p><p>Two &amp; &lt;b&gt;</p>");
    expect(textToHtml("   ")).toBe("");
  });
});

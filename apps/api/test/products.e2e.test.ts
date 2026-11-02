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
import { FakeVerifier } from "./support/fake-auth.js";

/**
 * E8-1: the catalogue. Products come from the store with their variants; Mizan adds the cost and
 * the barcode. A barcode set here stays when the store syncs again; null gives the store's back.
 * A costs file applies every line or none, naming each bad line.
 */
const fake = new FakeVerifier();
let app: INestApplication;
let db: Database;
let store: string;
let connectionId: string;
const http = () => request(app.getHttpServer());
const as = (token: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", "X-Tenant-Id": store });
const at = new Date().toISOString();
function product(id: string, title: string, variants: Array<{ id: string; sku?: string; barcode?: string; title?: string; price: string }>, status: CanonicalProduct["status"] = "active"): CanonicalProduct {
  return {
    connector: "shopify", externalId: `gid://shopify/Product/${id}`, title, status, tags: [], updatedAt: at,
    variants: variants.map((v) => ({ externalId: `gid://shopify/ProductVariant/${v.id}`, sku: v.sku, barcode: v.barcode, title: v.title ?? "Default Title", price: { amount: v.price, currency: "EGP" }, available: 7 })),
  };
}
const sync = (p: CanonicalProduct) => app.get(ProductProjector).project(store, connectionId, p);
const list = async (query = "") => (await http().get(`/v1/products${query}`).set(as("owner")).expect(200)).body;
const variant = (sku: string) => db.tenant(store, (trx) => trx.selectFrom("variants").selectAll().where("sku", "=", sku).executeTakeFirstOrThrow())
  .then((v) => ({ ...v, cogs_minor: String(v.cogs_minor), price_minor: String(v.price_minor) }));

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  db = app.get(Database);
  fake.add("owner", { uid: "fb-owner-products", email: "owner@products.test", emailVerified: true, secondFactor: "phone" });
  store = (await http().post("/v1/tenants").set({ Authorization: "Bearer owner" }).send({ name: "Nile Abayas", country: "EG" }).expect(201)).body.id;
  connectionId = await db.tenant(store, async (trx) => (await trx.insertInto("connections")
    .values({ tenant_id: store, kind: "store", provider: "shopify", external_account: "nile-abayas.myshopify.com" }).returning("id").executeTakeFirstOrThrow()).id);
  await sync(product("1", "Abaya", [{ id: "11", sku: "ABY-BLK", title: "Black", barcode: "6221000000011", price: "1150.00" }, { id: "12", sku: "ABY-GRY", title: "Grey", price: "1150.00" }]));
  await sync(product("2", "Scarf", [{ id: "21", sku: "SCF-1", price: "150.00" }]));
  await sync(product("3", "Old abaya", [{ id: "31", sku: "OLD-1", price: "900.00" }], "archived"));
  const inv = await http().post("/v1/members/invite").set(as("owner")).send({ phone: "01201117777", role: "agent" }).expect(201);
  fake.add("agent", { uid: "fb-agent-products", phone: inv.body.phone });
  await http().post(`/v1/invitations/${inv.body.id}/accept`).set({ Authorization: "Bearer agent" }).expect(200);
});
afterAll(() => app.close());

describe("the catalogue (E8-1)", () => {
  it("lists products by title with their variants, the store's barcode, and what is missing", async () => {
    const page = await list();
    expect(page.data.map((p: { title: string }) => p.title)).toEqual(["Abaya", "Scarf"]); // archived only when asked
    expect(page.data[0]).toMatchObject({
      status: "active", store: { connectionId, provider: "shopify", name: "nile-abayas.myshopify.com" },
      variants: [
        { sku: "ABY-BLK", title: "Black", barcode: "6221000000011", barcodeOwner: "store", price: { amount: "1150.00", currency: "EGP" }, cost: null, available: 7 },
        { sku: "ABY-GRY", barcode: null, cost: null },
      ],
    });
    expect(page.counts).toEqual({ products: 2, variants: 3, missingCost: 3, missingBarcode: 2 });
    expect((await list("?search=scf")).data.map((p: { title: string }) => p.title)).toEqual(["Scarf"]); // by SKU
    expect((await list("?search=6221000000011")).data.map((p: { title: string }) => p.title)).toEqual(["Abaya"]); // by barcode
    expect((await list("?search=100%25")).data).toEqual([]); // % is a character, not a wildcard
    expect((await list("?status=archived")).data.map((p: { title: string }) => p.title)).toEqual(["Old abaya"]);
    const first = await list("?limit=1");
    expect(first.data).toHaveLength(1);
    expect((await list(`?limit=1&cursor=${first.nextCursor}`)).data[0].title).toBe("Scarf");
  });

  it("sets a cost and a barcode; the barcode stays through store syncs until given back", async () => {
    const grey = await variant("ABY-GRY");
    const r = await http().patch(`/v1/products/variants/${grey.id}`).set(as("owner")).send({ cost: "420.50", barcode: "MZ-GRY-01" }).expect(200);
    expect(r.body).toMatchObject({ sku: "ABY-GRY", cost: { amount: "420.50", currency: "EGP" }, barcode: "MZ-GRY-01", barcodeOwner: "mizan" });

    // The store syncs with its own barcode: Mizan's stays; the store's price still follows.
    await sync(product("1", "Abaya", [{ id: "11", sku: "ABY-BLK", title: "Black", barcode: "6221000000011", price: "1200.00" }, { id: "12", sku: "ABY-GRY", title: "Grey", barcode: "6221000000012", price: "1200.00" }]));
    expect(await variant("ABY-GRY")).toMatchObject({ barcode: "MZ-GRY-01", price_minor: "120000", cogs_minor: "42050" });

    // Given back: the store's barcode returns at once.
    const back = await http().patch(`/v1/products/variants/${grey.id}`).set(as("owner")).send({ barcode: null }).expect(200);
    expect(back.body).toMatchObject({ barcode: "6221000000012", barcodeOwner: "store", cost: { amount: "420.50" } });
    const audit = await db.tenant(store, (trx) => trx.selectFrom("audit_log").select(["action", "after"]).where("entity_id", "=", grey.id).orderBy("id").execute());
    expect(audit.map((a) => a.action)).toEqual(["catalog.variant_updated", "catalog.variant_updated"]);
    const ev = await db.tenant(store, (trx) => trx.selectFrom("domain_events").select("data").where("type", "=", "costs.changed").orderBy("id", "desc").executeTakeFirstOrThrow());
    expect(ev.data).toMatchObject({ kind: "product_cost", variantIds: [grey.id] });
  });

  it("refuses a barcode another variant has, an empty change, an unknown variant, and other roles", async () => {
    const scarf = await variant("SCF-1");
    const clash = await http().patch(`/v1/products/variants/${scarf.id}`).set(as("owner")).send({ barcode: "6221000000011" }).expect(409);
    expect(clash.body).toMatchObject({ code: "barcode_taken", errors: [{ path: "barcode", message: "ABY-BLK" }] });
    expect((await http().patch(`/v1/products/variants/${scarf.id}`).set(as("owner")).send({}).expect(422)).body.code).toBe("validation_failed");
    expect((await http().patch(`/v1/products/variants/${scarf.id}`).set(as("owner")).send({ barcode: "has space" }).expect(422)).body.code).toBe("validation_failed");
    await http().patch("/v1/products/variants/33333333-3333-4333-8333-333333333333").set(as("owner")).send({ cost: "1" }).expect(404);
    await http().get("/v1/products").set(as("agent")).expect(403);
    await http().post("/v1/products/costs/import").set(as("agent")).send({ csv: "sku,cost\nSCF-1,1\n" }).expect(403);
  });

  it("imports a costs file: every line or none; barcodes can swap in one file", async () => {
    const bad = await http().post("/v1/products/costs/import").set(as("owner")).send({ csv: "sku,cost,barcode\nABY-BLK,400,\nNOPE,10,\nSCF-1,abc,\nABY-GRY,5,6221000000011\n" }).expect(422);
    expect(bad.body.code).toBe("csv_invalid");
    expect(bad.body.errors).toEqual([
      { path: "line:3", code: "unknown_sku", message: "NOPE" },
      { path: "line:4", code: "cost", message: "abc" },
      { path: "line:5", code: "barcode_taken", message: "6221000000011" }, // ABY-BLK keeps it
    ]);
    const taken = await http().post("/v1/products/costs/import").set(as("owner")).send({ csv: "sku,barcode\nSCF-1,6221000000011\n" }).expect(422);
    expect(taken.body.errors).toEqual([{ path: "line:2", code: "barcode_taken", message: "6221000000011" }]);
    expect((await variant("ABY-BLK")).cogs_set_at).toBeNull(); // nothing saved

    const ok = await http().post("/v1/products/costs/import").set(as("owner"))
      .send({ csv: "﻿Product,SKU,Barcode,Cost\r\nAbaya,ABY-BLK,6221000000012,\"1,000\"\r\nAbaya,ABY-GRY,6221000000011,410\r\nScarf,SCF-1,,\r\n" }).expect(200);
    expect(ok.body).toEqual({ costs: 2, barcodes: 2, skipped: 1, missingCost: 1 });
    expect(await variant("ABY-BLK")).toMatchObject({ cogs_minor: "100000", barcode: "6221000000012" });
    expect(await variant("ABY-GRY")).toMatchObject({ cogs_minor: "41000", barcode: "6221000000011" });
    expect((await variant("ABY-GRY")).barcode_set_at).not.toBeNull();
    const audit = await db.tenant(store, (trx) => trx.selectFrom("audit_log").select("after").where("action", "=", "catalog.costs_imported").executeTakeFirstOrThrow());
    expect(audit.after).toMatchObject({ costs: 2, barcodes: 2, skipped: 1 });
    expect((await list("?missing=cost")).data.map((p: { title: string }) => p.title)).toEqual(["Scarf"]);
  });
});

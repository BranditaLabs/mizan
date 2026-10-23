import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import { MizanEngine } from "@mizan/engine";
import { FakeClock, FakeShopify, seeded, testRuntime } from "@mizan/engine/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { EventDispatcher } from "../src/platform/events/dispatcher.js";
import { SecretsService } from "../src/platform/secrets/secrets.service.js";
import { EngineRegistry } from "../src/integrations/engine-registry.js";
import { EngineJobRunner } from "../src/integrations/engine-runner.js";
import { OffersService } from "../src/modules/confirmation/offers/offers.service.js";

/**
 * E6-13: an accepted offer joins the customer's Shopify order. offer.accepted → the engine's
 * order-edit job → the line is in Shopify, the order is read again (new total, new line in
 * Mizan) → offer applied. A sold-out item, or an order the store does not know, fails once and
 * tells the team; a WhatsApp customer is told the team will call.
 */
const T = "aaaaaaaa-0000-4000-8000-0000000000e6";
const clock = new FakeClock();
const shop = new FakeShopify(clock, seeded(61));
let app: INestApplication;
let db: Database;
let connectionId: string;
let scarf: { variantId: string };
let gone: { variantId: string };

const drain = async () => { const d = app.get(EventDispatcher); while ((await d.runOnce()).claimed > 0) { /* until empty */ } };
async function settle() {
  const runner = app.get(EngineJobRunner);
  for (let i = 0; i < 40; i++) {
    await drain();
    await runner.cycle(clock.now());
    await runner.idle();
    clock.advance(5_000);
  }
  await drain();
}
const variantOf = (ext: string) => db.tenant(T, (trx) => trx.selectFrom("external_variants").select("variant_id").where("external_id", "=", ext).executeTakeFirstOrThrow()).then((r) => r.variant_id!);
const orderOf = (ext: string) => db.tenant(T, (trx) => trx.selectFrom("orders").select(["id", "total_minor", "cod_minor"]).where("external_id", "=", ext).executeTakeFirstOrThrow());
const offerOf = (id: string) => db.tenant(T, (trx) => trx.selectFrom("order_offers").select(["status", "error"]).where("id", "=", id).executeTakeFirstOrThrow());

/** A proposed offer on a running confirmation, accepted the way the chat and the call script do it. */
async function accept(orderId: string, variantExt: string, channel: "whatsapp" | "call_team" = "call_team", pct = "10"): Promise<string> {
  const variantId = await variantOf(variantExt);
  const id = await db.tenant(T, async (trx) => {
    const run = await trx.insertInto("confirmation_runs").values({ tenant_id: T, order_id: orderId, status: "confirmed", link_expires_at: new Date(Date.now() + 86_400_000) }).returning("id").executeTakeFirstOrThrow();
    const price = 15000n;
    const offer = await trx.insertInto("order_offers").values({
      tenant_id: T, order_id: orderId, run_id: run.id, variant_id: variantId, qty: 1, currency: "EGP", unit_price_minor: price.toString(),
      discount_pct: pct, offer_price_minor: ((price * (100n - BigInt(pct))) / 100n).toString(), source: "rule",
    }).returning("id").executeTakeFirstOrThrow();
    await app.get(OffersService).decide(trx, T, offer.id, "accept", { channel });
    return offer.id;
  });
  return id;
}

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "http://localhost:3000", SHOPIFY_API_SECRET: shop.secret });
  app = await createApp(config, {
    logDestination: new Writable({ write: (_c, _e, d) => d() }),
    engineRuntime: () => testRuntime(clock, { [shop.host]: shop.handler }, seeded(62)),
  });
  await app.init();
  db = app.get(Database);
  await db.kysely.insertInto("tenants").values({ id: T, name: "Nile Abayas", slug: "nile-offers", settings: JSON.stringify({ phoneCountry: "EG" }) }).execute();
  connectionId = await db.tenant(T, async (trx) => {
    const ref = await app.get(SecretsService).create(trx, T, JSON.stringify({ accessToken: "shpat_fake_token" }), { actor: { type: "system" } });
    return (await trx.insertInto("connections").values({ tenant_id: T, kind: "store", provider: "shopify", external_account: shop.host, secret_ref: ref }).returning("id").executeTakeFirstOrThrow()).id;
  });
  scarf = shop.addProduct({ title: "Matching scarf", price: "150.00", sku: "SC-1", stock: 20 });
  gone = shop.addProduct({ title: "Gold pin", price: "150.00", sku: "PIN-1", stock: 0 });
  // Import: products into the catalogue (external_variants), orders into Mizan.
  const { store } = await app.get(EngineRegistry).get(T);
  await store.enqueue(MizanEngine.shopifyBackfillJob("import", clock.now() - 86_400_000, clock.now()), clock.now());
  await settle();
});
afterAll(() => app.close());

describe("an accepted offer joins the Shopify order (E6-13)", () => {
  it("accepted → added to the Shopify order at the offer's price → read back → applied, once", async () => {
    const o = shop.addOrder({ total: "1250.00" });
    const wh = shop.webhook("orders/create", o);
    await (await app.get(EngineRegistry).get(T)).engine.handleShopifyWebhook(wh.headers, wh.body);
    await settle();
    const before = await orderOf(o.id);
    expect(before.total_minor).toBe(125000n);

    const offer = await accept(before.id, scarf.variantId);
    expect(await offerOf(offer)).toMatchObject({ status: "accepted" });
    await settle();

    expect(shop.orders.get(o.id)!.lines.filter((l) => l.sku === "SC-1")).toEqual([expect.objectContaining({ quantity: 1, price: "135.00" })]);
    expect(shop.committedEdits).toBe(1);
    expect(await offerOf(offer)).toEqual({ status: "applied", error: null });
    const after = await orderOf(o.id);
    expect(after.total_minor).toBe(138500n); // the order was read again: the courier collects the new total
    expect(after.cod_minor).toBe(138500n);
    const lines = await db.tenant(T, (trx) => trx.selectFrom("order_lines").select(["sku", "variant_id"]).where("order_id", "=", before.id).execute());
    expect(lines).toContainEqual({ sku: "SC-1", variant_id: await variantOf(scarf.variantId) });
    const events = await db.tenant(T, (trx) => trx.selectFrom("domain_events").select("type").where("entity_id", "=", before.id).where("type", "like", "offer.%").execute());
    expect(events.map((e) => e.type)).toEqual(["offer.accepted", "offer.applied"]);
    const timeline = await db.tenant(T, (trx) => trx.selectFrom("order_events").select("type").where("order_id", "=", before.id).where("type", "like", "offer_%").execute());
    expect(timeline.map((e) => e.type)).toContain("offer_applied");

    // Accepting again, or the job again, adds nothing.
    await app.get(OffersService).recordResult(T, offer, { ok: false, reason: "failed", message: "late" });
    expect(await offerOf(offer)).toMatchObject({ status: "applied" });
    await settle();
    expect(shop.committedEdits).toBe(1);
  });

  it("a sold-out item fails once; a customer who accepted in the chat is told the team will call", async () => {
    const o = shop.addOrder();
    const wh = shop.webhook("orders/create", o);
    await (await app.get(EngineRegistry).get(T)).engine.handleShopifyWebhook(wh.headers, wh.body);
    await settle();
    const { id } = await orderOf(o.id);
    const offer = await accept(id, gone.variantId, "whatsapp", "0");
    await settle();
    expect(await offerOf(offer)).toEqual({ status: "failed", error: "validation" });
    expect(shop.orders.get(o.id)!.lines.some((l) => l.sku === "PIN-1")).toBe(false);
    const steps = await db.tenant(T, (trx) => trx.selectFrom("confirmation_steps as s").innerJoin("confirmation_runs as r", "r.id", "s.run_id")
      .select(["s.kind", "s.payload"]).where("r.order_id", "=", id).execute());
    expect(steps).toEqual([expect.objectContaining({ kind: "reply", payload: { message: "offer_failed" } })]);
  });

  it("an order the store does not know fails at once, without a job", async () => {
    const o = shop.addOrder();
    const wh = shop.webhook("orders/create", o);
    await (await app.get(EngineRegistry).get(T)).engine.handleShopifyWebhook(wh.headers, wh.body);
    await settle();
    const { id } = await orderOf(o.id);
    await db.tenant(T, (trx) => trx.updateTable("orders").set({ connection_id: null }).where("id", "=", id).execute());
    const edits = shop.committedEdits;
    const offer = await accept(id, scarf.variantId);
    await settle();
    expect(await offerOf(offer)).toEqual({ status: "failed", error: "not_in_store" });
    expect(shop.committedEdits).toBe(edits);
    expect(connectionId).toBeTruthy();
  });
});

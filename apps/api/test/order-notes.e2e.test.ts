import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import type { CanonicalOrder } from "@mizan/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { SecretsService } from "../src/platform/secrets/secrets.service.js";
import { OrderProjector } from "../src/modules/orders/order-projector.js";
import { FakeVerifier } from "./support/fake-auth.js";

/** O2: the team's notes and tags on an order, the list's new filters and columns, saved views. */
const fake = new FakeVerifier();
let app: INestApplication;
let db: Database;
let store: string;
let shopify: string;
let woo: string;
const ids: Record<string, string> = {};
const http = () => request(app.getHttpServer());
const as = (token: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", "X-Tenant-Id": store });
const numbers = async (query: string, token = "owner") => (await http().get(`/v1/orders${query}`).set(as(token)).expect(200)).body.data.map((o: { number: string }) => o.number);

const order = (n: number, over: Partial<CanonicalOrder> = {}): CanonicalOrder => ({
  connector: "shopify", externalId: `gid://shopify/Order/${7000 + n}`, number: `#${7000 + n}`,
  createdAt: new Date(Date.UTC(2026, 9, 21, 10, n)).toISOString(), updatedAt: new Date(Date.UTC(2026, 9, 21, 10, n)).toISOString(), currency: "EGP",
  total: { amount: "500.00", currency: "EGP" }, subtotal: { amount: "500.00", currency: "EGP" }, shipping: { amount: "0.00", currency: "EGP" },
  paymentMode: "cod", paymentStatus: "unpaid", gateways: ["Cash on Delivery (COD)"],
  received: { amount: "0.00", currency: "EGP" }, outstanding: { amount: "500.00", currency: "EGP" }, refunded: { amount: "0.00", currency: "EGP" },
  cancelled: false,
  customer: { name: "Mona Adel", phone: "+201001234821" },
  shippingAddress: { name: "Mona Adel", phone: "01001234821", line1: "12 Abbas El Akkad St", city: "Nasr City", province: "Cairo", countryCode: "EG" },
  lines: [{ externalLineId: `L${n}`, sku: `SKU-${n}`, title: "Abaya", quantity: 1, unitPrice: { amount: "500.00", currency: "EGP" } }],
  fulfillmentGroups: [], tags: [],
  ...over,
});

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "http://localhost:3000" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  db = app.get(Database);
  fake.add("owner", { uid: "fb-owner", email: "owner@nile.test", emailVerified: true, secondFactor: "phone" });
  store = (await http().post("/v1/tenants").set({ Authorization: "Bearer owner" }).send({ name: "Nile Abayas", country: "EG" }).expect(201)).body.id;
  const join = async (token: string, phone: string, role: string) => {
    const inv = await http().post("/v1/members/invite").set(as("owner")).send({ phone, role }).expect(201);
    fake.add(token, { uid: `fb-${token}`, phone: inv.body.phone });
    await http().post(`/v1/invitations/${inv.body.id}/accept`).set({ Authorization: `Bearer ${token}` }).expect(200);
  };
  await join("agent", "01201112222", "agent");
  await join("agent2", "01201115555", "agent");

  const secrets = app.get(SecretsService);
  [shopify, woo] = await db.tenant(store, async (trx) => {
    const conn = async (provider: string, account: string) => {
      const ref = await secrets.create(trx, store, JSON.stringify({ accessToken: "fake" }), { actor: { type: "system" } });
      return (await trx.insertInto("connections").values({ tenant_id: store, kind: "store", provider, external_account: account, secret_ref: ref }).returning("id").executeTakeFirstOrThrow()).id;
    };
    return [await conn("shopify", "nile.myshopify.com"), await conn("woocommerce", "https://nile.example")];
  });
  const projector = app.get(OrderProjector);
  await projector.project(store, shopify, order(1, { tags: ["wholesale"] }));
  await projector.project(store, shopify, order(2, { shippingAddress: { name: "Karim", phone: "01112223334", line1: "5 Tahrir St", city: " giza ", countryCode: "EG" } }));
  await projector.project(store, shopify, order(3, { shippingAddress: { name: "Sara", phone: "01112223335", line1: "9 Nile St", city: "Giza", countryCode: "EG" } }));
  await projector.project(store, woo, order(4, { connector: "woocommerce", externalId: "4004", number: "4004" }));
  for (const o of await db.tenant(store, (trx) => trx.selectFrom("orders").select(["id", "number"]).execute())) ids[o.number] = o.id;

  // #7003 holds the kaftan and went with Bosta.
  await db.tenant(store, async (trx) => {
    const product = (await trx.insertInto("products").values({ tenant_id: store, title: "Kaftan" }).returning("id").executeTakeFirstOrThrow()).id;
    const variant = (await trx.insertInto("variants").values({ tenant_id: store, product_id: product, sku: "KAF-1", currency: "EGP" }).returning("id").executeTakeFirstOrThrow()).id;
    ids.kaftan = product;
    await trx.updateTable("order_lines").set({ variant_id: variant }).where("order_id", "=", ids["#7003"]!).execute();
    const bosta = (await trx.insertInto("connections").values({ tenant_id: store, kind: "courier", provider: "bosta", display_name: "Bosta" }).returning("id").executeTakeFirstOrThrow()).id;
    ids.bosta = bosta;
    await trx.insertInto("shipments").values({ tenant_id: store, order_id: ids["#7003"]!, connection_id: bosta, provider: "bosta", currency: "EGP", tracking_number: "BOS-1" }).execute();
  });
});
afterAll(() => app.close());

describe("notes on an order (O2)", () => {
  it("adds, lists (newest first) and removes notes; stored encrypted; the timeline and event never carry the text", async () => {
    const url = `/v1/orders/${ids["#7001"]}/notes`;
    const first = (await http().post(url).set(as("owner")).send({ body: "Customer asked to call after 5 pm" }).expect(201)).body;
    expect(first).toMatchObject({ body: "Customer asked to call after 5 pm", mine: true, author: { id: expect.any(String) } });
    await http().post(url).set(as("agent")).send({ body: "x" }).expect(404); // not assigned to the agent: not in their scope
    const agentId = (await db.kysely.selectFrom("users").select("id").where("firebase_uid", "=", "fb-agent").executeTakeFirstOrThrow()).id;
    await db.tenant(store, (trx) => trx.updateTable("orders").set({ assigned_to: agentId }).where("id", "=", ids["#7001"]!).execute());
    const second = (await http().post(url).set(as("agent")).send({ body: "  Near the mosque, 3rd floor  " }).expect(201)).body;
    expect(second.body).toBe("Near the mosque, 3rd floor");

    const notes = (await http().get(url).set(as("owner")).expect(200)).body.data;
    expect(notes.map((n: { body: string; mine: boolean }) => [n.body, n.mine])).toEqual([["Near the mosque, 3rd floor", false], ["Customer asked to call after 5 pm", true]]);

    const stored = await db.tenant(store, (trx) => trx.selectFrom("order_notes").select("body").execute());
    expect(stored.every((r) => r.body.startsWith("pii:v1:"))).toBe(true);
    const trail = JSON.stringify(await db.tenant(store, async (trx) => [
      await trx.selectFrom("order_events").select(["type", "data"]).where("order_id", "=", ids["#7001"]!).execute(),
      await trx.selectFrom("domain_events").select(["type", "data"]).where("type", "=", "order.note_added").execute(),
    ]));
    expect(trail).toContain("note_added");
    expect(trail).not.toMatch(/mosque|5 pm/);

    // The agent can take back their own note only; the owner can remove any (audited).
    await http().delete(`${url}/${first.id}`).set(as("agent")).expect(403);
    await http().delete(`${url}/${second.id}`).set(as("agent")).expect(204);
    await http().delete(`${url}/${first.id}`).set(as("owner")).expect(204);
    expect((await http().get(url).set(as("owner")).expect(200)).body.data).toEqual([]);
    const audit = await db.tenant(store, (trx) => trx.selectFrom("audit_log").select("action").where("action", "=", "order.note_removed").execute());
    expect(audit).toHaveLength(2);
    await http().post(url).set(as("owner")).send({ body: "" }).expect(422);
  });

  it("a note shows on the list as a count, and goes with the customer's data when it is deleted", async () => {
    await http().post(`/v1/orders/${ids["#7002"]}/notes`).set(as("owner")).send({ body: "Karim's brother receives" }).expect(201);
    const row = (await http().get("/v1/orders").set(as("owner")).expect(200)).body.data.find((o: { number: string }) => o.number === "#7002");
    expect(row.notes).toBe(1);
    // A redaction (shop/customers redact) takes the order's notes with it.
    await db.tenant(store, async (trx) => {
      const { PrivacyService } = await import("../src/modules/privacy/privacy.service.js");
      await (app.get(PrivacyService) as unknown as { redact(t: unknown, s: string, c: string, x: object): Promise<unknown> }).redact(trx, store, shopify, { orderIds: ["gid://shopify/Order/7002"] });
    });
    expect(await db.tenant(store, (trx) => trx.selectFrom("order_notes").select("id").where("order_id", "=", ids["#7002"]!).execute())).toEqual([]);
  });
});

describe("tags on an order (O2)", () => {
  it("adds and removes tags (the store's own too), in Shopify through the outbox, on the timeline", async () => {
    const url = `/v1/orders/${ids["#7001"]}/tags`;
    expect((await http().patch(url).set(as("owner")).send({ add: ["VIP", "gift wrap"] }).expect(200)).body.tags).toEqual(["wholesale", "vip", "gift wrap"]);
    expect((await http().patch(url).set(as("owner")).send({ remove: ["wholesale", "not-there"] }).expect(200)).body.tags).toEqual(["vip", "gift wrap"]);
    await http().patch(url).set(as("owner")).send({}).expect(422);
    await http().patch(url).set(as("owner")).send({ add: ["no/slash"] }).expect(422);

    const jobs = await db.tenant(store, (trx) => trx.selectFrom("mz_outbox").select(["kind", "payload"]).where("kind", "in", ["shopify.addTags", "shopify.removeTags"]).orderBy("created_at").execute());
    expect(jobs.map((j) => [j.kind, (j.payload as { tags: string[] }).tags])).toEqual([["shopify.addTags", ["vip", "gift wrap"]], ["shopify.removeTags", ["wholesale"]]]);
    const detail = (await http().get(`/v1/orders/${ids["#7001"]}`).set(as("owner")).expect(200)).body;
    expect(detail.events.filter((e: { type: string }) => e.type.endsWith("tagged")).map((e: { type: string; data: { tags: string[] } }) => [e.type, e.data.tags]))
      .toEqual([["untagged", ["wholesale"]], ["tagged", ["vip", "gift wrap"]]]);
  });

  it("a WooCommerce order keeps the team's tags when the store syncs it again (WooCommerce orders have none)", async () => {
    await http().patch(`/v1/orders/${ids["4004"]}/tags`).set(as("owner")).send({ add: ["call-back"] }).expect(200);
    await app.get(OrderProjector).project(store, woo, order(4, { connector: "woocommerce", externalId: "4004", number: "4004", total: { amount: "550.00", currency: "EGP" } }));
    const o = await db.tenant(store, (trx) => trx.selectFrom("orders").select(["tags", "total_minor"]).where("id", "=", ids["4004"]!).executeTakeFirstOrThrow());
    expect(o).toMatchObject({ tags: ["call-back"], total_minor: 55000n });
    const jobs = await db.tenant(store, (trx) => trx.selectFrom("mz_outbox").select("id").where("payload", "@>", JSON.stringify({ tags: ["call-back"] })).execute());
    expect(jobs).toEqual([]); // nothing to send to WooCommerce
  });
});

describe("filters, columns and saved views (O2)", () => {
  it("filters by tag, city (ignoring case and spaces), courier and product; rows carry city and courier", async () => {
    expect(await numbers("?tag=vip")).toEqual(["#7001"]);
    expect(await numbers("?city=GIZA")).toEqual(["#7003", "#7002"]);
    expect(await numbers(`?courierId=${ids.bosta}`)).toEqual(["#7003"]);
    expect(await numbers(`?productId=${ids.kaftan}`)).toEqual(["#7003"]);
    expect(await numbers(`?city=giza&tag=vip`)).toEqual([]);
    const row = (await http().get(`/v1/orders?productId=${ids.kaftan}`).set(as("owner")).expect(200)).body.data[0];
    expect(row).toMatchObject({ city: "Giza", courier: { id: ids.bosta, provider: "bosta", name: "Bosta" } });
  });

  it("offers the store's tags, cities and couriers, most orders first, within the caller's scope", async () => {
    const f = (await http().get("/v1/orders/filters").set(as("owner")).expect(200)).body;
    expect(f.cities).toEqual([{ value: expect.stringMatching(/^giza$/i), count: 2 }, { value: "Nasr City", count: 2 }]);
    expect(f.tags.map((t: { value: string }) => t.value).sort()).toEqual(["call-back", "gift wrap", "vip"]);
    expect(f.couriers).toEqual([{ id: ids.bosta, provider: "bosta", name: "Bosta", count: 1 }]);
    const agent = (await http().get("/v1/orders/filters").set(as("agent")).expect(200)).body; // only #7001 is theirs
    expect(agent.cities).toEqual([{ value: "Nasr City", count: 1 }]);
    expect(agent.couriers).toEqual([]);
  });

  it("saves views: own ones, shared ones by leads; names unique per person; only the author or a lead removes", async () => {
    const mine = (await http().post("/v1/orders/views").set(as("agent")).send({ name: "Giza to confirm", filters: { city: "Giza", status: "new" } }).expect(201)).body;
    expect(mine).toMatchObject({ name: "Giza to confirm", filters: { city: "Giza", status: "new" }, shared: false, mine: true });
    await http().post("/v1/orders/views").set(as("agent")).send({ name: "Giza to confirm", filters: {} }).expect(409);
    await http().post("/v1/orders/views").set(as("agent")).send({ name: "Team", filters: {}, shared: true }).expect(403);
    await http().post("/v1/orders/views").set(as("agent")).send({ name: "Bad", filters: { status: "lost" } }).expect(422);
    const team = (await http().post("/v1/orders/views").set(as("owner")).send({ name: "VIP", filters: { tag: "vip" }, shared: true }).expect(201)).body;

    const views = async (token: string) => (await http().get("/v1/orders/views").set(as(token)).expect(200)).body.data.map((v: { name: string; mine: boolean }) => [v.name, v.mine]);
    expect(await views("agent")).toEqual([["Giza to confirm", true], ["VIP", false]]);
    expect(await views("agent2")).toEqual([["VIP", false]]);
    expect(await views("owner")).toEqual([["VIP", true]]); // the agent's own view is theirs alone

    await http().delete(`/v1/orders/views/${mine.id}`).set(as("agent2")).expect(404);
    await http().delete(`/v1/orders/views/${team.id}`).set(as("agent")).expect(403);
    await http().delete(`/v1/orders/views/${mine.id}`).set(as("agent")).expect(204);
    await http().delete(`/v1/orders/views/${team.id}`).set(as("owner")).expect(204);
    expect(await views("agent")).toEqual([]);
  });
});

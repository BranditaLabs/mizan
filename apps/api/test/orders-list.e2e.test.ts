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
import { customerLabel, OrderProjector, REDACTED_ORDER } from "../src/modules/orders/order-projector.js";
import { FakeVerifier } from "./support/fake-auth.js";

/** E5-1: GET /v1/orders — newest first, counts per status, cursor pages, search without decryption, role scope. */
const fake = new FakeVerifier();
let app: INestApplication;
let db: Database;
let store: string;
let connectionId: string;
const http = () => request(app.getHttpServer());
const as = (token: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", "X-Tenant-Id": store });
const list = async (query = "", token = "owner") => (await http().get(`/v1/orders${query}`).set(as(token)).expect(200)).body;

const order = (n: number, over: Partial<CanonicalOrder> = {}): CanonicalOrder => ({
  connector: "shopify", externalId: `gid://shopify/Order/${9000 + n}`, number: `#${9000 + n}`,
  createdAt: new Date(Date.UTC(2026, 9, 20, 10, n)).toISOString(), updatedAt: new Date(Date.UTC(2026, 9, 20, 10, n)).toISOString(), currency: "EGP",
  total: { amount: `${1000 + n}.00`, currency: "EGP" }, subtotal: { amount: `${1000 + n}.00`, currency: "EGP" }, shipping: { amount: "0.00", currency: "EGP" },
  paymentMode: "cod", paymentStatus: "unpaid", gateways: ["Cash on Delivery (COD)"],
  received: { amount: "0.00", currency: "EGP" }, outstanding: { amount: `${1000 + n}.00`, currency: "EGP" }, refunded: { amount: "0.00", currency: "EGP" },
  cancelled: false,
  customer: { name: "Mona Adel", phone: "+201001234821", email: "mona@example.com" },
  shippingAddress: { name: "Mona Adel", phone: "010 0123 4821", line1: "12 Abbas El Akkad St", city: "Nasr City", province: "Cairo", countryCode: "EG" },
  lines: [{ externalLineId: `L${n}`, sku: "AB-1", title: "Abaya", quantity: 1, unitPrice: { amount: `${1000 + n}.00`, currency: "EGP" } }],
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
  connectionId = await db.tenant(store, async (trx) => {
    const ref = await app.get(SecretsService).create(trx, store, JSON.stringify({ accessToken: "shpat_fake_token" }), { actor: { type: "system" } });
    return (await trx.insertInto("connections").values({ tenant_id: store, kind: "store", provider: "shopify", external_account: "nile.myshopify.com", secret_ref: ref }).returning("id").executeTakeFirstOrThrow()).id;
  });
  const projector = app.get(OrderProjector);
  for (let n = 1; n <= 7; n++) {
    const other = n === 6 ? { customer: { name: "Karim El-Sayed", phone: "+201112223334" }, shippingAddress: { name: "Karim El-Sayed", phone: "٠١١١٢٢٢٣٣٣٤", line1: "5 Tahrir St", city: "Giza", countryCode: "EG" } } : {};
    const prepaid = n === 7 ? { paymentMode: "prepaid" as const, paymentStatus: "paid" as const, gateways: ["paymob"], received: { amount: "1007.00", currency: "EGP" }, outstanding: { amount: "0.00", currency: "EGP" } } : {};
    await projector.project(store, connectionId, order(n, { ...other, ...prepaid }));
  }
  // Statuses come from confirmation and shipping (E6, E7); set them here.
  const set = (numbers: string[], status: string) => db.tenant(store, (trx) => trx.updateTable("orders").set({ status }).where("number", "in", numbers).execute());
  await set(["#9002", "#9003"], "confirmed");
  await set(["#9004"], "shipped");
  await set(["#9005"], "cancelled");
});
afterAll(() => app.close());

describe("GET /v1/orders", () => {
  it("lists newest first with a masked customer, cash to collect from the payment, and no personal data", async () => {
    const page = await list();
    expect(page.data.map((o: { number: string }) => o.number)).toEqual(["#9007", "#9006", "#9005", "#9004", "#9003", "#9002", "#9001"]);
    expect(page.data[6]).toMatchObject({
      status: "new", channel: "store", store: { connectionId, provider: "shopify" }, customer: { label: "Mona A.", phoneLast4: "4821" },
      total: { amount: "1001.00", currency: "EGP" }, cod: { amount: "1001.00", currency: "EGP" }, paymentMode: "cod", paymentStatus: "unpaid",
    });
    expect(page.data[1].customer).toEqual({ label: "Karim E.", phoneLast4: "3334" }); // Arabic-Indic digits in the store's phone
    expect(page.data[0]).toMatchObject({ paymentMode: "prepaid", cod: { amount: "0.00" } });
    expect(JSON.stringify(page)).not.toMatch(/Mona Adel|Adel|Abbas|0123|mona@|\+2010/);
    expect(page.counts).toEqual({ all: 7, new: 3, pending_confirmation: 0, confirmed: 2, cancelled: 1, shipped: 1, delivered: 0, returned: 0 });
    expect(page.nextCursor).toBeNull();
  });

  it("filters by status and payment; counts follow search and filters but not the status tab", async () => {
    const confirmed = await list("?status=confirmed");
    expect(confirmed.data.map((o: { number: string }) => o.number)).toEqual(["#9003", "#9002"]);
    expect(confirmed.counts.all).toBe(7);
    const prepaid = await list("?paymentMode=prepaid");
    expect(prepaid.data.map((o: { number: string }) => o.number)).toEqual(["#9007"]);
    expect(prepaid.counts).toMatchObject({ all: 1, new: 1, confirmed: 0 });
    const window = await list(`?from=${encodeURIComponent("2026-10-20T10:03:00Z")}&to=${encodeURIComponent("2026-10-20T10:05:00Z")}`);
    expect(window.data.map((o: { number: string }) => o.number)).toEqual(["#9004", "#9003"]);
  });

  it("pages with a cursor: every order once", async () => {
    const seen: string[] = [];
    let cursor: string | null = "";
    for (let i = 0; i < 10 && cursor !== null; i++) {
      const page: { data: Array<{ number: string }>; nextCursor: string | null } = await list(`?limit=3${cursor ? `&cursor=${cursor}` : ""}`);
      seen.push(...page.data.map((o) => o.number));
      cursor = page.nextCursor;
    }
    expect(seen).toEqual(["#9007", "#9006", "#9005", "#9004", "#9003", "#9002", "#9001"]);
    expect((await http().get("/v1/orders?cursor=bm9wZQ").set(as("owner")).expect(422)).body.code).toBe("validation_failed");
  });

  it("searches order numbers (with or without #), store ids, and phones in any form, without decrypting", async () => {
    const numbers = async (q: string) => (await list(`?q=${encodeURIComponent(q)}`)).data.map((o: { number: string }) => o.number);
    expect(await numbers("#9003")).toEqual(["#9003"]);
    expect(await numbers("9003")).toEqual(["#9003"]);
    expect(await numbers("gid://shopify/Order/9005")).toEqual(["#9005"]);
    expect(await numbers("+20 111 222 3334")).toEqual(["#9006"]);
    expect(await numbers("٠١١١٢٢٢٣٣٣٤")).toEqual(["#9006"]);
    expect(await numbers("01001234821")).toHaveLength(6);
    expect(await numbers("Mona")).toEqual([]); // names are encrypted: not searchable by design
    expect(await numbers("90%")).toEqual([]); // LIKE wildcards are literal
  });

  it("scopes by role: agents see their assigned orders, warehouse sees confirmed and shipped, media buyers none", async () => {
    const join = async (token: string, phone: string, role: string) => {
      const inv = await http().post("/v1/members/invite").set(as("owner")).send({ phone, role }).expect(201);
      fake.add(token, { uid: `fb-${token}`, phone: inv.body.phone });
      await http().post(`/v1/invitations/${inv.body.id}/accept`).set({ Authorization: `Bearer ${token}` }).expect(200);
    };
    await join("agent", "01201112222", "agent");
    await join("wh", "01201113333", "warehouse");
    await join("media", "01201114444", "media_buyer");
    const agentId = (await db.kysely.selectFrom("users").select("id").where("firebase_uid", "=", "fb-agent").executeTakeFirstOrThrow()).id;
    await db.tenant(store, (trx) => trx.updateTable("orders").set({ assigned_to: agentId }).where("number", "=", "#9001").execute());

    expect((await list("", "agent")).data.map((o: { number: string }) => o.number)).toEqual(["#9001"]);
    expect((await list("", "agent")).counts.all).toBe(1);
    expect((await list("", "wh")).data.map((o: { number: string }) => o.number)).toEqual(["#9004", "#9003", "#9002"]);
    expect((await http().get("/v1/orders").set(as("media")).expect(403)).body.code).toBe("insufficient_role");
  });
});

describe("list label", () => {
  it("is first name and last initial in both scripts; redaction clears it with the rest", () => {
    expect(customerLabel("Mona Adel")).toBe("Mona A.");
    expect(customerLabel("منى عادل محمد")).toBe("منى م.");
    expect(customerLabel("Karim")).toBe("Karim");
    expect(customerLabel("  ")).toBeNull();
    expect(REDACTED_ORDER).toMatchObject({ customer_label: null, phone_last4: null });
  });
});

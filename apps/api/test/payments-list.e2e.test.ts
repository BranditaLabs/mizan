import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { EventDispatcher } from "../src/platform/events/dispatcher.js";
import { MessagingRegistry } from "../src/modules/confirmation/messaging.registry.js";
import { LedgerService } from "../src/modules/payments/ledger.service.js";
import { FakeVerifier } from "./support/fake-auth.js";

/**
 * E14-6: the payments screen lists orders by where their money stands (unpaid, paid, cash still
 * to collect, refunds, disputes) with counts and per-currency sums; the home shows the mix.
 */
const fake = new FakeVerifier();
let app: INestApplication;
let db: Database;
let store: string;
const o: Record<string, { id: string; number: string }> = {};
const http = () => request(app.getHttpServer());
const as = (token: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", "X-Tenant-Id": store });
const drain = async () => { const d = app.get(EventDispatcher); while ((await d.runOnce()).claimed > 0) { /* until empty */ } };
const order = async (payment: object, price = "1000") => {
  const r = await http().post("/v1/orders").set(as("owner")).send({
    source: "phone", customer: { name: "Mona Adel", phone: "01001234821" }, address: { line1: "12 Abbas El Akkad St", city: "Nasr City" },
    lines: [{ title: "Abaya", quantity: 1, unitPrice: price }], shipping: "0", payment,
  }).expect(201);
  await drain();
  return r.body as { id: string; number: string };
};
const view = async (q: string, token = "finance") => (await http().get(`/v1/payments${q}`).set(as(token)).expect(200)).body;
const ids = (page: { data: Array<{ order: { id: string } }> }) => page.data.map((r) => r.order.id).sort();
const egp = (amount: string) => ({ amount, currency: "EGP" });

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  db = app.get(Database);
  app.get(MessagingRegistry).use(null);
  fake.add("owner", { uid: "fb-owner-paylist", email: "owner@paylist.test", emailVerified: true, secondFactor: "phone" });
  store = (await http().post("/v1/tenants").set({ Authorization: "Bearer owner" }).send({ name: "Nile Payments", country: "EG" }).expect(201)).body.id;
  for (const [token, role, phone] of [["finance", "finance", "01201117771"], ["agent", "agent", "01201117772"]] as const) {
    const inv = await http().post("/v1/members/invite").set(as("owner")).send({ phone, role }).expect(201);
    fake.add(token, { uid: `fb-${token}-paylist`, phone: inv.body.phone });
    await http().post(`/v1/invitations/${inv.body.id}/accept`).set({ Authorization: `Bearer ${token}` }).expect(200);
  }
  o.cod = await order({ mode: "cod" });
  o.transfer = await order({ mode: "bank_transfer" });
  o.prepaid = await order({ mode: "prepaid", method: "wallet" }, "500");
  o.deposit = await order({ mode: "partial", method: "instapay", paid: "300" });
  o.refunded = await order({ mode: "bank_transfer" });
  await http().post(`/v1/orders/${o.refunded.id}/payments`).set(as("finance")).send({ type: "received", method: "bank_transfer", amount: "1000" }).expect(201);
  await http().post(`/v1/orders/${o.refunded.id}/payments`).set(as("finance")).send({ type: "refunded", method: "bank_transfer", amount: "100" }).expect(201);
  o.disputed = await order({ mode: "prepaid", method: "card" });
  const ledger = app.get(LedgerService);
  await db.tenant(store, (trx) => ledger.post(trx, store, o.disputed!.id, { kind: "chargeback", method: "card", amountMinor: -100000n, currency: "EGP", source: "gateway", externalRef: "cb-1" }, { type: "engine" }));
  o.cancelled = await order({ mode: "cod" });
  await db.tenant(store, (trx) => trx.updateTable("orders").set({ status: "cancelled" }).where("id", "=", o.cancelled!.id).execute());
});
afterAll(() => app.close());

describe("payments list (E14-6)", () => {
  it("each view holds the orders whose money stands that way, with counts for every view", async () => {
    const all = await view("?limit=100");
    expect(all.counts).toEqual({ all: 7, unpaid: 1, paid: 1, cod_due: 2, refunds: 1, disputes: 1 });
    expect(ids(await view("?view=unpaid"))).toEqual([o.transfer!.id]);
    expect(ids(await view("?view=paid"))).toEqual([o.prepaid!.id]);
    expect(ids(await view("?view=cod_due"))).toEqual([o.cod!.id, o.deposit!.id].sort()); // not the cancelled one
    expect(ids(await view("?view=refunds"))).toEqual([o.refunded!.id]);
    expect(ids(await view("?view=disputes"))).toEqual([o.disputed!.id]);

    const deposit = (await view("?view=cod_due")).data.find((r: { order: { id: string } }) => r.order.id === o.deposit!.id);
    expect(deposit).toMatchObject({ mode: "partial", status: "partially_paid", methods: ["instapay"], total: egp("1000.00"), paid: egp("300.00"), balance: egp("700.00"), cod: egp("700.00") });
    const refunded = (await view("?view=refunds")).data[0];
    expect(refunded).toMatchObject({ status: "partially_refunded", paid: egp("1000.00"), refunded: egp("100.00"), balance: egp("0.00"), methods: ["bank_transfer"] });
    expect((await view("?view=disputes")).data[0]).toMatchObject({ status: "disputed", methods: ["card"] });
  });

  it("sums the view per currency, filters by mode and number, and pages", async () => {
    expect((await view("?view=cod_due")).totals).toEqual([{ currency: "EGP", total: egp("2000.00"), paid: egp("300.00"), refunded: egp("0.00"), balance: egp("1700.00"), cod: egp("1700.00") }]);
    const transfers = await view("?mode=bank_transfer");
    expect(ids(transfers)).toEqual([o.transfer!.id, o.refunded!.id].sort());
    expect(transfers.counts).toMatchObject({ all: 2, unpaid: 1, refunds: 1, cod_due: 0 });
    expect(ids(await view(`?q=${encodeURIComponent(o.deposit!.number)}`))).toEqual([o.deposit!.id]);

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: { data: Array<{ order: { id: string } }>; nextCursor: string | null } = await view(`?limit=3${cursor ? `&cursor=${cursor}` : ""}`);
      seen.push(...page.data.map((r) => r.order.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
    await http().get("/v1/payments?cursor=bad").set(as("finance")).expect(422);
  });

  it("the home's payment mix: orders by mode and money in by method", async () => {
    const mix = (await http().get("/v1/payments/mix?days=30").set(as("owner")).expect(200)).body;
    expect(mix.orders).toBe(6); // the cancelled order is left out
    expect(mix.modes).toEqual([
      { mode: "prepaid", orders: 2, pct: 33.3 }, { mode: "bank_transfer", orders: 2, pct: 33.3 },
      { mode: "cod", orders: 1, pct: 16.7 }, { mode: "partial", orders: 1, pct: 16.7 },
    ].sort((a, b) => b.orders - a.orders || a.mode.localeCompare(b.mode)));
    expect(mix.received).toEqual(expect.arrayContaining([
      { method: "bank_transfer", amount: egp("1000.00") }, { method: "card", amount: egp("1000.00") },
      { method: "wallet", amount: egp("500.00") }, { method: "instapay", amount: egp("300.00") },
    ]));
    await http().get("/v1/payments/mix?days=12").set(as("owner")).expect(422);
  });

  it("finance and managers only; a disputed order still lists among orders", async () => {
    await http().get("/v1/payments").set(as("agent")).expect(403);
    await http().get("/v1/payments/mix").set(as("agent")).expect(403);
    const orders = (await http().get("/v1/orders?limit=100").set(as("owner")).expect(200)).body;
    expect(orders.data.find((x: { id: string }) => x.id === o.disputed!.id)).toMatchObject({ paymentStatus: "disputed" });
    await http().get(`/v1/orders/${o.disputed!.id}`).set(as("owner")).expect(200);
  });
});

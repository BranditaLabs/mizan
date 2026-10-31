import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import type { CanonicalOrder } from "@mizan/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { EventDispatcher } from "../src/platform/events/dispatcher.js";
import { MessagingRegistry } from "../src/modules/confirmation/messaging.registry.js";
import { OrderProjector } from "../src/modules/orders/order-projector.js";
import { TicketsRefundsConsumer } from "../src/modules/tickets/tickets-refunds.consumer.js";
import { FakeVerifier } from "./support/fake-auth.js";

/**
 * E14-4: a refund never exceeds what the order holds less refunds still open; under the store's
 * threshold it is approved at once, over it owner, admin or finance approve (never whoever asked,
 * unless the owner); store credit completes on approval, money back through the store completes
 * when the store reports it, a transfer or cash when the team records it. Each completed refund
 * is one refund line in the ledger; a refund on a ticket shows in the ticket's history.
 */
const fake = new FakeVerifier();
let app: INestApplication;
let db: Database;
let store: string;
let connectionId: string;
const http = () => request(app.getHttpServer());
const as = (token: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", "X-Tenant-Id": store });
const drain = async () => { const d = app.get(EventDispatcher); while ((await d.runOnce()).claimed > 0) { /* until empty */ } };
const egp = (amount: string) => ({ amount, currency: "EGP" });
const order = async (payment: object, price = "1000") => {
  const r = await http().post("/v1/orders").set(as("owner")).send({
    source: "phone", customer: { name: "Mona Adel", phone: "01001234821" }, address: { line1: "12 Abbas El Akkad St", city: "Nasr City" },
    lines: [{ title: "Abaya", quantity: 1, unitPrice: price }], shipping: "0", payment,
  }).expect(201);
  await drain();
  return r.body.id as string;
};
const paidTransfer = async () => {
  const id = await order({ mode: "bank_transfer" });
  await http().post(`/v1/orders/${id}/payments`).set(as("finance")).send({ type: "received", method: "bank_transfer", amount: "1000" }).expect(201);
  return id;
};
const ask = (orderId: string, body: object, token = "finance") => http().post(`/v1/orders/${orderId}/refunds`).set(as(token)).send(body);
const act = (id: string, step: "approve" | "reject" | "complete", body: object = {}, token = "finance") => http().post(`/v1/refunds/${id}/${step}`).set(as(token)).send(body);
const lines = (orderId: string) => db.tenant(store, (trx) => trx.selectFrom("payments").select(["kind", "method", "source", "amount_minor", "note"]).where("order_id", "=", orderId).orderBy("created_at").execute());
const money = (orderId: string) => db.tenant(store, (trx) => trx.selectFrom("orders").select(["paid_minor", "refunded_minor", "payment_status"]).where("id", "=", orderId).executeTakeFirstOrThrow());

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  db = app.get(Database);
  app.get(MessagingRegistry).use(null);
  fake.add("owner", { uid: "fb-owner-refunds", email: "owner@refunds.test", emailVerified: true, secondFactor: "phone" });
  store = (await http().post("/v1/tenants").set({ Authorization: "Bearer owner" }).send({ name: "Nile Refunds", country: "EG" }).expect(201)).body.id;
  for (const [token, role, phone] of [["finance", "finance", "01201118881"], ["ops", "ops_manager", "01201118882"], ["agent", "agent", "01201118883"]] as const) {
    const inv = await http().post("/v1/members/invite").set(as("owner")).send({ phone, role }).expect(201);
    fake.add(token, { uid: `fb-${token}-refunds`, phone: inv.body.phone });
    await http().post(`/v1/invitations/${inv.body.id}/accept`).set({ Authorization: `Bearer ${token}` }).expect(200);
  }
  connectionId = await db.tenant(store, async (trx) => (await trx.insertInto("connections").values({ tenant_id: store, kind: "store", provider: "shopify", external_account: "nile-refunds.myshopify.com", status: "active" }).returning("id").executeTakeFirstOrThrow()).id);
});
afterAll(() => app.close());

describe("refunds (E14-4)", () => {
  it("under the threshold: approved at once; the team sends a transfer and records it; one refund line in the ledger", async () => {
    const id = await paidTransfer();
    const opts = (await http().get(`/v1/orders/${id}/refunds/options`).set(as("ops")).expect(200)).body;
    expect(opts).toEqual({ refundable: egp("1000.00"), destinations: ["store_credit", "bank_transfer", "cash"], approveOver: egp("1000.00") });

    const r = (await ask(id, { amount: "200", destination: "bank_transfer", reason: "Wrong size, kept the scarf" }, "ops").expect(201)).body;
    expect(r).toMatchObject({ number: "R-1001", status: "approved", needsApproval: false, amount: egp("200.00"), destination: "bank_transfer", can: { approve: false, reject: false, complete: false }, completesFromStore: false });
    expect((await http().get(`/v1/orders/${id}/refunds/options`).set(as("ops")).expect(200)).body.refundable).toEqual(egp("800.00")); // the open refund is set aside
    await act(r.id, "complete", { reference: "CIB-55102" }, "ops").expect(403);
    expect(r.can).toEqual({ approve: false, reject: false, complete: false }); // ops asks; finance sends
    const done = (await act(r.id, "complete", { reference: "CIB-55102" }).expect(200)).body;
    expect(done).toMatchObject({ status: "completed", reference: "CIB-55102", completedAt: expect.any(String) });
    await act(r.id, "complete", {}).expect(409);

    expect((await lines(id)).filter((l) => l.kind === "refund")).toEqual([{ kind: "refund", method: "bank_transfer", source: "manual", amount_minor: -20000n, note: "CIB-55102" }]);
    expect(await money(id)).toMatchObject({ paid_minor: 100000n, refunded_minor: 20000n, payment_status: "partially_refunded" });
    await drain();
    const ev = await db.tenant(store, (trx) => trx.selectFrom("domain_events").select(["type", "data"]).where("entity_id", "=", id).where("type", "like", "refund.%").orderBy("occurred_at").execute());
    expect(ev.map((e) => e.type).sort()).toEqual(["refund.approved", "refund.completed", "refund.created"]); // one transaction: one timestamp
    expect(ev.find((e) => e.type === "refund.completed")!.data).toMatchObject({ refundId: r.id, refund: "R-1001", destination: "bank_transfer", amountMinor: "-20000" });
    const audit = await db.tenant(store, (trx) => trx.selectFrom("audit_log").select("action").where("entity_id", "=", id).where("action", "like", "refund.%").orderBy("created_at").execute());
    expect(audit.map((a) => a.action).sort()).toEqual(["refund.approved", "refund.completed", "refund.requested"]);
  });

  it("over the threshold: someone other than who asked approves (the owner may approve their own); rejections keep their reason", async () => {
    await http().put("/v1/settings/refunds").set(as("ops")).send({ approveOver: "100" }).expect(403);
    await http().put("/v1/settings/refunds").set(as("owner")).send({ approveOver: "abc" }).expect(422);
    expect((await http().put("/v1/settings/refunds").set(as("owner")).send({ approveOver: "١٠٠" }).expect(200)).body).toEqual({ approveOver: "100" });
    const id = await paidTransfer();

    const big = (await ask(id, { amount: "300", destination: "cash" }).expect(201)).body;
    expect(big).toMatchObject({ status: "requested", needsApproval: true, can: { approve: false, reject: true, complete: false } });
    await act(big.id, "approve").expect(403).expect((x) => expect(x.body.code).toBe("own_refund"));
    await act(big.id, "approve", {}, "ops").expect(403);
    expect((await act(big.id, "approve", {}, "owner").expect(200)).body).toMatchObject({ status: "approved", approvedBy: { id: expect.any(String) } });

    const own = (await ask(id, { amount: "150", destination: "bank_transfer" }, "owner").expect(201)).body;
    expect((await act(own.id, "approve", {}, "owner").expect(200)).body.status).toBe("approved");

    const no = (await ask(id, { amount: "120", destination: "bank_transfer" }, "ops").expect(201)).body;
    expect((await act(no.id, "reject", { reason: "Customer kept the item" }).expect(200)).body).toMatchObject({ status: "rejected", rejectionReason: "Customer kept the item" });
    await act(no.id, "reject", { reason: "again" }).expect(409);
    await act(no.id, "approve", {}, "owner").expect(409);

    // 1000 held: 300 + 150 approved, so at most 550 more.
    await ask(id, { amount: "550.01", destination: "cash" }).expect(409).expect((x) => expect(x.body.code).toBe("over_refund"));
    await ask(id, { amount: "50", destination: "cash" }, "agent").expect(403);
    const list = (await http().get(`/v1/refunds?orderId=${id}&status=all`).set(as("finance")).expect(200)).body;
    expect(list.counts).toEqual({ requested: 0, approved: 2, completed: 0, rejected: 1 });
    expect((await http().get("/v1/refunds").set(as("finance")).expect(200)).body.data.every((x: { status: string }) => ["requested", "approved"].includes(x.status))).toBe(true);
    await http().put("/v1/settings/refunds").set(as("owner")).send({ approveOver: "1000" }).expect(200);
  });

  it("where the money can go: not back to a method it never came by, nothing back that was never paid; store credit completes at once", async () => {
    const cod = await order({ mode: "cod" });
    expect((await http().get(`/v1/orders/${cod}/refunds/options`).set(as("finance")).expect(200)).body).toMatchObject({ refundable: egp("0.00"), destinations: ["store_credit", "bank_transfer", "cash"] });
    await ask(cod, { amount: "10", destination: "cash" }).expect(409);
    const transfer = await paidTransfer();
    await ask(transfer, { amount: "10", destination: "original_method" }).expect(422).expect((x) => expect(x.body.code).toBe("destination_unavailable"));
    await ask(transfer, { amount: "10.001", destination: "cash" }).expect(422);

    const wallet = await order({ mode: "prepaid", method: "wallet" }, "500");
    const credit = (await ask(wallet, { amount: "120", destination: "store_credit" }).expect(201)).body;
    expect(credit.status).toBe("completed");
    const sc = await db.tenant(store, (trx) => trx.selectFrom("store_credit_ledger").select(["delta_minor", "reason", "ref_id"]).where("ref_id", "=", credit.id).execute());
    expect(sc).toEqual([{ delta_minor: 12000n, reason: "refund", ref_id: credit.id }]);
    // Mizan's own order: back to the wallet, done in the gateway's dashboard, recorded here.
    const back = (await ask(wallet, { amount: "100", destination: "original_method" }).expect(201)).body;
    expect(back).toMatchObject({ completesFromStore: false, can: { complete: true } });
    await act(back.id, "complete", { reference: "PMB-881" }).expect(200);
    expect((await lines(wallet)).filter((l) => l.kind === "refund").map((l) => [l.method, String(l.amount_minor)])).toEqual([["store_credit", "-12000"], ["wallet", "-10000"]]);
  });

  it("back through the store's checkout: done in the store, completed when the store reports it, booked once", async () => {
    const projector = app.get(OrderProjector);
    const o: CanonicalOrder = {
      connector: "shopify", externalId: "gid://shopify/Order/9901", number: "#9901", createdAt: "2026-10-26T09:00:00Z", updatedAt: "2026-10-26T09:00:00Z", currency: "EGP",
      total: egp("1000.00"), subtotal: egp("1000.00"), shipping: egp("0.00"), paymentMode: "prepaid", paymentStatus: "paid", gateways: ["Paymob"],
      received: egp("1000.00"), outstanding: egp("0.00"), refunded: egp("0.00"), cancelled: false, customer: { name: "Mona Adel", phone: "+201001234821" },
      shippingAddress: { name: "Mona Adel", phone: "01001234821", line1: "12 Abbas El Akkad St", city: "Cairo", countryCode: "EG" },
      lines: [{ externalLineId: "L1", sku: "AB-1", title: "Abaya", quantity: 1, unitPrice: egp("1000.00") }], fulfillmentGroups: [], tags: [],
    };
    await projector.project(store, connectionId, o);
    await drain();
    const id = (await db.tenant(store, (trx) => trx.selectFrom("orders").select("id").where("external_id", "=", o.externalId).executeTakeFirstOrThrow())).id;
    const r = (await ask(id, { amount: "300", destination: "original_method" }).expect(201)).body;
    expect(r).toMatchObject({ status: "approved", completesFromStore: true, can: { complete: false } });
    await act(r.id, "complete", {}).expect(409).expect((x) => expect(x.body.code).toBe("completes_from_store"));

    await projector.project(store, connectionId, { ...o, updatedAt: "2026-10-26T10:00:00Z", refunded: egp("300.00"), paymentStatus: "partially_refunded" });
    const done = (await http().get(`/v1/refunds?orderId=${id}&status=all`).set(as("finance")).expect(200)).body.data[0];
    expect(done).toMatchObject({ id: r.id, status: "completed" });
    expect((await lines(id)).filter((l) => l.kind === "refund")).toEqual([{ kind: "refund", method: "card", source: "store", amount_minor: -30000n, note: null }]);
    expect(await money(id)).toMatchObject({ refunded_minor: 30000n });
  });

  it("a refund on a ticket shows in the ticket's history", async () => {
    const id = await paidTransfer();
    const tk = (await http().post("/v1/tickets").set(as("owner")).send({ type: "refund", reason: "damaged", orderId: id }).expect(201)).body;
    const other = await order({ mode: "cod" });
    const elsewhere = (await http().post("/v1/tickets").set(as("owner")).send({ type: "complaint", orderId: other }).expect(201)).body;
    await ask(id, { amount: "50", destination: "cash", ticketId: elsewhere.id }).expect(422);
    const r = (await ask(id, { amount: "250", destination: "bank_transfer", ticketId: tk.id }).expect(201)).body;
    expect(r.ticket).toEqual({ id: tk.id, number: tk.number });
    await act(r.id, "complete", { reference: "NBE-1" }).expect(200);
    await drain();
    await drain();
    const history = (await http().get(`/v1/tickets/${tk.id}`).set(as("owner")).expect(200)).body.history;
    expect(history.filter((h: { type: string }) => h.type === "refund").map((h: { data: { step: string; refund: string; amountMinor: string } }) => [h.data.step, h.data.refund, h.data.amountMinor]).sort())
      .toEqual([["approved", r.number, "25000"], ["completed", r.number, "25000"], ["requested", r.number, "25000"]]);
    // Delivered again, it is not written twice.
    const consumer = app.get(TicketsRefundsConsumer);
    const again = { id: "00000000-0000-4000-8000-0000000000aa", type: "refund.completed" as const, tenantId: store, entity: { type: "order", id }, actor: { type: "system" as const }, occurredAt: new Date().toISOString(), data: { refundId: r.id, refund: r.number, ticketId: tk.id, amountMinor: "-25000", currency: "EGP" } };
    await db.tenant(store, (trx) => consumer.handle(again as never, trx));
    await db.tenant(store, (trx) => consumer.handle(again as never, trx));
    expect((await http().get(`/v1/tickets/${tk.id}`).set(as("owner")).expect(200)).body.history.filter((h: { type: string }) => h.type === "refund")).toHaveLength(3);
  });
});

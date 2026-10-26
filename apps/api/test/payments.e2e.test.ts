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
import { ProblemError } from "../src/platform/http/problem.js";
import { MessagingRegistry } from "../src/modules/confirmation/messaging.registry.js";
import { OrderProjector } from "../src/modules/orders/order-projector.js";
import { LedgerService } from "../src/modules/payments/ledger.service.js";
import { LEDGER_KINDS, type LedgerKind } from "../src/modules/payments/ledger.js";
import { FakeVerifier } from "./support/fake-auth.js";

/**
 * E14-1: every money movement is a ledger line, and the order's paid, refunded, status and cash
 * to collect are the ledger's sums, kept in the same transaction. The team records what it
 * received or gave back; the store's totals keep arriving without wiping those entries.
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
const orderRow = (id: string) => db.tenant(store, (trx) => trx.selectFrom("orders").select(["paid_minor", "refunded_minor", "balance_minor", "payment_status", "cod_minor"]).where("id", "=", id).executeTakeFirstOrThrow());
const lines = (id: string) => db.tenant(store, (trx) => trx.selectFrom("payments").select(["kind", "method", "source", "status", "amount_minor", "note"]).where("order_id", "=", id).orderBy("created_at").execute());
const manualOrder = async (payment: object) => {
  const r = await http().post("/v1/orders").set(as("owner")).send({
    source: "phone", customer: { name: "Mona Adel", phone: "01001234821" }, address: { line1: "12 Abbas El Akkad St", city: "Nasr City" },
    lines: [{ title: "Abaya", quantity: 1, unitPrice: "1000" }], shipping: "0", payment,
  }).expect(201);
  await drain();
  return r.body.id as string;
};
let n = 0;
function shopify(over: Partial<CanonicalOrder> = {}): CanonicalOrder {
  n++;
  return {
    connector: "shopify", externalId: `gid://shopify/Order/${8100 + n}`, number: `#${8100 + n}`, createdAt: "2026-10-26T09:00:00Z", updatedAt: "2026-10-26T09:00:00Z", currency: "EGP",
    total: egp("1000.00"), subtotal: egp("1000.00"), shipping: egp("0.00"),
    paymentMode: "partial", paymentStatus: "partially_paid", gateways: ["Paymob"],
    received: egp("250.00"), outstanding: egp("750.00"), refunded: egp("0.00"),
    cancelled: false, customer: { name: "Mona Adel", phone: "+201001234821" },
    shippingAddress: { name: "Mona Adel", phone: "01001234821", line1: "12 Abbas El Akkad St", city: "Cairo", countryCode: "EG" },
    lines: [{ externalLineId: `L${n}`, sku: "AB-1", title: "Abaya", quantity: 1, unitPrice: egp("1000.00") }],
    fulfillmentGroups: [], tags: [], ...over,
  };
}

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  db = app.get(Database);
  app.get(MessagingRegistry).use(null);
  fake.add("owner", { uid: "fb-owner-ledger", email: "owner@ledger.test", emailVerified: true, secondFactor: "phone" });
  store = (await http().post("/v1/tenants").set({ Authorization: "Bearer owner" }).send({ name: "Nile Ledger", country: "EG" }).expect(201)).body.id;
  for (const [token, role, phone] of [["finance", "finance", "01201115551"], ["ops", "ops_manager", "01201115552"], ["agent", "agent", "01201115553"]] as const) {
    const inv = await http().post("/v1/members/invite").set(as("owner")).send({ phone, role }).expect(201);
    fake.add(token, { uid: `fb-${token}-ledger`, phone: inv.body.phone });
    await http().post(`/v1/invitations/${inv.body.id}/accept`).set({ Authorization: `Bearer ${token}` }).expect(200);
  }
  connectionId = await db.tenant(store, async (trx) => (await trx.insertInto("connections").values({ tenant_id: store, kind: "store", provider: "shopify", external_account: "nile-ledger.myshopify.com", status: "active" }).returning("id").executeTakeFirstOrThrow()).id);
});
afterAll(() => app.close());

describe("payment ledger (E14-1)", () => {
  it("a bank transfer arrives in two parts, then part is refunded: the order follows the ledger, every entry audited", async () => {
    const id = await manualOrder({ mode: "bank_transfer" });
    const empty = await http().get(`/v1/orders/${id}/payments`).set(as("finance")).expect(200);
    expect(empty.body).toMatchObject({ status: "unpaid", total: egp("1000.00"), paid: egp("0.00"), balance: egp("1000.00"), canRecord: true, lines: [] });

    // Arabic digits and separators are read as the team types them.
    const first = await http().post(`/v1/orders/${id}/payments`).set(as("finance")).send({ type: "received", method: "instapay", amount: "٤٠٠", note: "IPN-7781" }).expect(201);
    expect(first.body).toMatchObject({ status: "partially_paid", paid: egp("400.00"), balance: egp("600.00") });
    expect(first.body.lines).toEqual([expect.objectContaining({ kind: "sale", method: "instapay", source: "manual", status: "succeeded", amount: egp("400.00"), note: "IPN-7781", recordedBy: null })]);

    await http().post(`/v1/orders/${id}/payments`).set(as("finance")).send({ type: "received", method: "bank_transfer", amount: "600.01" }).expect(409)
      .expect((r) => expect(r.body.code).toBe("over_payment"));
    await http().post(`/v1/orders/${id}/payments`).set(as("owner")).send({ type: "received", method: "bank_transfer", amount: "600" }).expect(201)
      .expect((r) => expect(r.body).toMatchObject({ status: "paid", paid: egp("1000.00"), balance: egp("0.00"), net: egp("1000.00") }));

    await http().post(`/v1/orders/${id}/payments`).set(as("finance")).send({ type: "refunded", method: "wallet", amount: "1000.01" }).expect(409)
      .expect((r) => expect(r.body.code).toBe("over_refund"));
    const refunded = await http().post(`/v1/orders/${id}/payments`).set(as("finance")).send({ type: "refunded", method: "wallet", amount: "150.50" }).expect(201);
    expect(refunded.body).toMatchObject({ status: "partially_refunded", paid: egp("1000.00"), refunded: egp("150.50"), net: egp("849.50") });
    expect(refunded.body.lines.map((l: { kind: string }) => l.kind)).toEqual(["refund", "sale", "sale"]); // newest first

    expect(await orderRow(id)).toMatchObject({ paid_minor: 100000n, refunded_minor: 15050n, balance_minor: 0n, payment_status: "partially_refunded" });
    const ls = await lines(id);
    expect(ls.reduce((a, l) => a + BigInt(l.amount_minor), 0n)).toBe(84950n); // the lines sum to what the merchant holds

    const events = await db.tenant(store, (trx) => trx.selectFrom("domain_events").select(["type", "data"]).where("entity_id", "=", id)
      .where("type", "in", ["payment.received", "refund.completed", "order.payment_changed"]).orderBy("occurred_at").execute());
    expect(events.map((e) => e.type)).toEqual(["payment.received", "order.payment_changed", "payment.received", "order.payment_changed", "refund.completed", "order.payment_changed"]);
    expect(events[0]!.data).toMatchObject({ kind: "sale", method: "instapay", source: "manual", amountMinor: "40000", currency: "EGP" });
    const audit = await db.tenant(store, (trx) => trx.selectFrom("audit_log").select(["action", "after"]).where("entity_id", "=", id).where("action", "=", "payment.recorded").execute());
    expect(audit).toHaveLength(3);
    expect(JSON.stringify(audit)).not.toContain("IPN-7781"); // the note stays in the ledger, not the audit trail
  });

  it("only owner, admin and finance record; ops managers read; agents see neither", async () => {
    const id = await manualOrder({ mode: "cod" });
    await http().get(`/v1/orders/${id}/payments`).set(as("ops")).expect(200).expect((r) => expect(r.body.canRecord).toBe(false));
    await http().post(`/v1/orders/${id}/payments`).set(as("ops")).send({ type: "received", method: "bank_transfer", amount: "10" }).expect(403);
    await http().get(`/v1/orders/${id}/payments`).set(as("agent")).expect(403);
    await http().post(`/v1/orders/${id}/payments`).set(as("finance")).send({ type: "received", method: "card", amount: "10" }).expect(422);
    await http().post(`/v1/orders/${id}/payments`).set(as("finance")).send({ type: "received", method: "bank_transfer", amount: "0" }).expect(422);
    await http().post(`/v1/orders/${id}/payments`).set(as("finance")).send({ type: "received", method: "bank_transfer", amount: "10.0001" }).expect(422);
    await http().post(`/v1/orders/${id}/payments`).set(as("finance")).send({ type: "refunded", method: "bank_transfer", amount: "1" }).expect(409); // nothing held yet
    await http().get("/v1/orders/00000000-0000-4000-8000-000000000000/payments").set(as("finance")).expect(404);
    // A COD order paid in advance by transfer: the courier collects only what is still owed.
    await http().post(`/v1/orders/${id}/payments`).set(as("finance")).send({ type: "received", method: "bank_transfer", amount: "300" }).expect(201);
    expect(await orderRow(id)).toMatchObject({ paid_minor: 30000n, cod_minor: 70000n, payment_status: "partially_paid" });
  });

  it("the store's totals keep arriving without wiping the team's entries", async () => {
    const projector = app.get(OrderProjector);
    const o = shopify();
    await projector.project(store, connectionId, o);
    await drain();
    const id = (await db.tenant(store, (trx) => trx.selectFrom("orders").select("id").where("external_id", "=", o.externalId).executeTakeFirstOrThrow())).id;
    expect(await orderRow(id)).toMatchObject({ paid_minor: 25000n, cod_minor: 75000n, payment_status: "partially_paid" });

    // The customer sent the rest by InstaPay instead of paying the courier.
    await http().post(`/v1/orders/${id}/payments`).set(as("finance")).send({ type: "received", method: "instapay", amount: "750" }).expect(201);
    expect(await orderRow(id)).toMatchObject({ paid_minor: 100000n, cod_minor: 0n, payment_status: "paid" });

    // The same store state again (a webhook replay, a later edit): nothing changes.
    await projector.project(store, connectionId, { ...o, updatedAt: "2026-10-26T10:00:00Z", tags: ["vip"] });
    expect(await orderRow(id)).toMatchObject({ paid_minor: 100000n, cod_minor: 0n, payment_status: "paid" });

    // The store refunds 100: a store line for it; the team's line stays.
    await projector.project(store, connectionId, { ...o, updatedAt: "2026-10-26T11:00:00Z", refunded: egp("100.00"), paymentStatus: "partially_refunded" });
    await projector.project(store, connectionId, { ...o, updatedAt: "2026-10-26T11:00:00Z", refunded: egp("100.00"), paymentStatus: "partially_refunded" });
    expect(await orderRow(id)).toMatchObject({ paid_minor: 100000n, refunded_minor: 10000n, payment_status: "partially_refunded" });
    expect((await lines(id)).map((l) => [l.kind, l.source, String(l.amount_minor)])).toEqual([["sale", "store", "25000"], ["sale", "manual", "75000"], ["refund", "store", "-10000"]]);

    // Paid, voided, paid again in the store: each change is its own line.
    const p = shopify({ paymentMode: "prepaid", paymentStatus: "paid", received: egp("1000.00"), outstanding: egp("0.00") });
    await projector.project(store, connectionId, p);
    await projector.project(store, connectionId, { ...p, updatedAt: "2026-10-26T10:00:00Z", received: egp("0.00"), paymentStatus: "voided" });
    await projector.project(store, connectionId, { ...p, updatedAt: "2026-10-26T11:00:00Z", received: egp("1000.00"), paymentStatus: "paid" });
    const pid = (await db.tenant(store, (trx) => trx.selectFrom("orders").select("id").where("external_id", "=", p.externalId).executeTakeFirstOrThrow())).id;
    expect(await orderRow(pid)).toMatchObject({ paid_minor: 100000n, payment_status: "paid" });
    expect((await lines(pid)).map((l) => String(l.amount_minor))).toEqual(["100000", "-100000", "100000"]);
  });

  it("whatever is posted, the order's totals are the sums of its lines (gateway lines, replays, refusals)", async () => {
    const ledger = app.get(LedgerService);
    const id = await manualOrder({ mode: "prepaid" });
    let seed = 7;
    const r = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    let refused = 0;
    let replays = 0;
    let last: { kind: LedgerKind; amountMinor: bigint; externalRef: string } | null = null;
    for (let i = 0; i < 60; i++) {
      const kind = LEDGER_KINDS[Math.floor(r() * LEDGER_KINDS.length)]! as LedgerKind;
      const size = BigInt(1 + Math.floor(r() * 60_000));
      const negative = kind === "refund" || kind === "chargeback" || kind === "void";
      // Every fourth post is the gateway sending the last transaction again.
      const line: { kind: LedgerKind; amountMinor: bigint; externalRef: string } = i % 4 === 3 && last ? last : { kind, amountMinor: negative ? -size : size, externalRef: `txn-${i}` };
      try {
        const res = await db.tenant(store, (trx) => ledger.post(trx, store, id, {
          ...line, method: "card", currency: "EGP", source: "gateway", connectionId, status: r() < 0.15 ? "failed" : "succeeded",
        }, { type: "engine" }));
        if (res.duplicate) replays++;
        last = line;
      } catch (e) {
        expect(e).toBeInstanceOf(ProblemError);
        refused++;
      }
      const o = await orderRow(id);
      const ls = (await lines(id)).filter((l) => l.status === "succeeded");
      const sum = (kinds: string[]) => ls.filter((l) => kinds.includes(l.kind)).reduce((a, l) => a + BigInt(l.amount_minor), 0n);
      expect(BigInt(o.paid_minor)).toBe(sum(["sale", "capture", "cod_collection", "void"]));
      expect(BigInt(o.refunded_minor)).toBe(-sum(["refund"]));
      expect(BigInt(String(o.balance_minor ?? 0))).toBe(100000n - BigInt(o.paid_minor));
      expect(sum(["sale", "capture", "cod_collection", "void", "refund", "chargeback", "chargeback_reversal"]) >= 0n).toBe(true);
    }
    expect(refused).toBeGreaterThan(5);
    expect(replays).toBeGreaterThan(5);
    // A different currency is never mixed in.
    await expect(db.tenant(store, (trx) => ledger.post(trx, store, id, { kind: "sale", method: "card", amountMinor: 1n, currency: "USD", source: "gateway", externalRef: "usd-1", connectionId }, { type: "engine" })))
      .rejects.toMatchObject({ status: 422 });
  });
});

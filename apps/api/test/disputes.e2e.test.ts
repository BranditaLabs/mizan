import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { EventDispatcher } from "../src/platform/events/dispatcher.js";
import { FakeVerifier } from "./support/fake-auth.js";

/**
 * E14-5: chargebacks. Recorded on an order (once per gateway case), the amount leaves the ledger
 * with its fee and the order shows disputed; the evidence pack holds the order, the delivery and the
 * payments, with the customer's name and address audited; won puts the money back, lost does not.
 */
const fake = new FakeVerifier();
let app: INestApplication;
let db: Database;
let store: string;
const http = () => request(app.getHttpServer());
const as = (token: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", "X-Tenant-Id": store });
const drain = async () => { const d = app.get(EventDispatcher); while ((await d.runOnce()).claimed > 0) { /* until empty */ } };
let n = 0;
async function paidOrder(total = "900") {
  const r = await http().post("/v1/orders").set(as("owner")).send({
    source: "phone", customer: { name: "Hala Samir", phone: `0111300${String(++n).padStart(4, "0")}` }, address: { line1: "7 Gameat El Dowal St", city: "Giza" },
    lines: [{ title: "Leather bag", quantity: 1, unitPrice: total }], shipping: "0", payment: { mode: "bank_transfer" },
  }).expect(201);
  await http().post(`/v1/orders/${r.body.id}/payments`).set(as("owner")).send({ type: "received", method: "instapay", amount: total }).expect(201);
  await drain();
  return r.body as { id: string; number: string };
}
const ledger = async (id: string) => (await http().get(`/v1/orders/${id}/payments`).set(as("owner")).expect(200)).body;

beforeAll(async () => {
  app = await createApp(loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test" }), { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  db = app.get(Database);
  fake.add("owner", { uid: "fb-owner-ds", email: "owner@ds.test", emailVerified: true, secondFactor: "phone" });
  store = (await http().post("/v1/tenants").set({ Authorization: "Bearer owner" }).send({ name: "Nile Disputes", country: "EG" }).expect(201)).body.id;
  for (const [name, phone, role] of [["agent", "01201117771", "agent"], ["ops", "01201117772", "ops_manager"]] as const) {
    const inv = await http().post("/v1/members/invite").set(as("owner")).send({ phone, role }).expect(201);
    fake.add(name, { uid: `fb-${name}-ds`, phone: inv.body.phone });
    await http().post(`/v1/invitations/${inv.body.id}/accept`).set({ Authorization: `Bearer ${name}` }).expect(200);
  }
});
afterAll(() => app.close());

describe("disputes (E14-5)", () => {
  it("records a chargeback once per case; the ledger, status and profit follow; more than the order holds is refused", async () => {
    const o = await paidOrder();
    const before = (await http().get(`/v1/orders/${o.id}/pnl`).set(as("owner")).expect(200)).body;
    await http().post(`/v1/orders/${o.id}/disputes`).set(as("agent")).send({ amount: "900", reason: "fraud" }).expect(403);
    await http().post(`/v1/orders/${o.id}/disputes`).set(as("ops")).send({ amount: "900", reason: "fraud" }).expect(403);
    expect((await http().post(`/v1/orders/${o.id}/disputes`).set(as("owner")).send({ amount: "950", reason: "fraud" }).expect(409)).body.code).toBe("over_chargeback");

    const respondBy = new Date(Date.now() + 6.5 * 86_400_000).toISOString();
    const d = (await http().post(`/v1/orders/${o.id}/disputes`).set(as("owner")).send({ amount: "٩٠٠", fee: "150", reason: "not_received", respondBy, externalRef: "PMB-CB-1", note: "Bank says not received" }).expect(201)).body;
    expect(d).toMatchObject({ number: "D-1001", order: { number: o.number }, status: "open", reason: "not_received", amount: { amount: "900.00" }, fee: { amount: "150.00" }, method: "instapay", daysLeft: 7, externalRef: "PMB-CB-1", source: "manual" });
    // The same case again is the same dispute, not a second chargeback.
    expect((await http().post(`/v1/orders/${o.id}/disputes`).set(as("owner")).send({ amount: "900", reason: "fraud", externalRef: "PMB-CB-1" }).expect(201)).body.id).toBe(d.id);
    const other = await paidOrder("300");
    expect((await http().post(`/v1/orders/${other.id}/disputes`).set(as("owner")).send({ amount: "100", reason: "fraud", externalRef: "PMB-CB-1" }).expect(409)).body.code).toBe("case_on_other_order");

    const l = await ledger(o.id);
    expect(l).toMatchObject({ status: "disputed", chargedBack: { amount: "900.00" }, net: { amount: "0.00" } });
    expect(l.lines[0]).toMatchObject({ kind: "chargeback", method: "instapay", amount: { amount: "-900.00" }, fee: { amount: "150.00" }, feeIsActual: true });
    await drain();
    const after = (await http().get(`/v1/orders/${o.id}/pnl`).set(as("owner")).expect(200)).body;
    expect(after.chargebacks).toMatchObject({ amount: "1050.00" });
    expect(Number(after.net.amount)).toBeCloseTo(Number(before.net.amount) - 1050, 2);

    const events = await db.tenant(store, (trx) => trx.selectFrom("domain_events").select(["type", "data"]).where("entity_id", "=", o.id).where("type", "like", "dispute.%").execute());
    expect(events).toEqual([{ type: "dispute.opened", data: expect.objectContaining({ dispute: "D-1001", reason: "not_received", feeMinor: "15000" }) }]);
    expect((await http().get("/v1/disputes").set(as("ops")).expect(200)).body).toMatchObject({ data: [{ id: d.id }], counts: { open: 1 } });
    await http().get("/v1/disputes").set(as("agent")).expect(403);
  });

  it("builds the evidence pack (audited), takes the evidence, and a won dispute puts the money back", async () => {
    const o = await paidOrder("500");
    const d = (await http().post(`/v1/orders/${o.id}/disputes`).set(as("owner")).send({ amount: "500", fee: "50", reason: "fraud" }).expect(201)).body;
    await http().get(`/v1/disputes/${d.id}/evidence`).set(as("ops")).expect(403);
    const pack = (await http().get(`/v1/disputes/${d.id}/evidence`).set(as("owner")).expect(200)).body;
    expect(pack).toMatchObject({
      dispute: { id: d.id }, store: { name: "Nile Disputes", country: "EG" },
      order: { number: o.number, total: { amount: "500.00" }, lines: [{ title: "Leather bag", quantity: 1, unitPrice: { amount: "500.00" } }] },
      customer: { name: "Hala Samir", address: { line1: "7 Gameat El Dowal St", city: "Giza" } },
      shipments: [], messages: [],
    });
    expect(pack.customer.phoneLast4).toMatch(/^\d{4}$/);
    expect(pack.payments.map((p: { kind: string }) => p.kind)).toEqual(["sale", "chargeback"]);
    const viewed = await db.tenant(store, (trx) => trx.selectFrom("audit_log").select("after").where("action", "=", "dispute.evidence_viewed").where("entity_id", "=", o.id).execute());
    expect(viewed).toHaveLength(1);
    expect(JSON.stringify(viewed[0]!.after)).not.toContain("Hala");

    const sent = (await http().post(`/v1/disputes/${d.id}/evidence`).set(as("owner")).send({ note: "Uploaded on the Paymob portal" }).expect(200)).body;
    expect(sent).toMatchObject({ status: "evidence_submitted", evidenceNote: "Uploaded on the Paymob portal" });
    expect((await http().post(`/v1/disputes/${d.id}/evidence`).set(as("owner")).send({}).expect(409)).body.code).toBe("not_open");

    const won = (await http().post(`/v1/disputes/${d.id}/close`).set(as("owner")).send({ outcome: "won" }).expect(200)).body;
    expect(won).toMatchObject({ status: "won", daysLeft: null });
    expect(won.closedAt).toBeTruthy();
    expect(await ledger(o.id)).toMatchObject({ status: "paid", chargedBack: { amount: "0.00" }, net: { amount: "500.00" } });
    await drain();
    const pnl = (await http().get(`/v1/orders/${o.id}/pnl`).set(as("owner")).expect(200)).body;
    expect(pnl.chargebacks).toMatchObject({ amount: "50.00" }); // the fee stays a cost
    expect((await http().post(`/v1/disputes/${d.id}/close`).set(as("owner")).send({ outcome: "lost" }).expect(409)).body.code).toBe("closed");
  });

  it("a lost or accepted dispute keeps the money out; lists filter by state and order", async () => {
    const o = await paidOrder("400");
    const a = (await http().post(`/v1/orders/${o.id}/disputes`).set(as("owner")).send({ amount: "150", reason: "duplicate" }).expect(201)).body;
    const b = (await http().post(`/v1/orders/${o.id}/disputes`).set(as("owner")).send({ amount: "100", reason: "other" }).expect(201)).body;
    await http().post(`/v1/disputes/${a.id}/close`).set(as("owner")).send({ outcome: "lost", note: "Bank sided with the cardholder" }).expect(200);
    await http().post(`/v1/disputes/${b.id}/close`).set(as("owner")).send({ outcome: "accepted" }).expect(200);
    expect(await ledger(o.id)).toMatchObject({ status: "disputed", chargedBack: { amount: "250.00" }, net: { amount: "150.00" } });
    const closed = (await http().get(`/v1/disputes?status=closed&orderId=${o.id}`).set(as("owner")).expect(200)).body;
    expect(closed.data.map((x: { status: string }) => x.status).sort()).toEqual(["accepted", "lost"]);
    expect(closed.counts).toMatchObject({ lost: 1, accepted: 1, open: 0 });
    expect((await http().get(`/v1/disputes?status=open&orderId=${o.id}`).set(as("owner")).expect(200)).body.data).toEqual([]);
    const audits = await db.tenant(store, (trx) => trx.selectFrom("audit_log").select("action").where("entity_id", "=", o.id).where("action", "like", "dispute.%").execute());
    expect(audits.map((x) => x.action).sort()).toEqual(["dispute.closed", "dispute.closed", "dispute.opened", "dispute.opened"]);
  });
});

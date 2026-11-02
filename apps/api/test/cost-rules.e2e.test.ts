import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { CostRulesService } from "../src/modules/profit/cost-rules.service.js";
import { addDays, localDay } from "../src/modules/profit/store-day.js";
import { FakeVerifier } from "./support/fake-auth.js";

/** E9-1: cost rules are versioned per kind and scope; resolve() picks the one for an order's day. */
const fake = new FakeVerifier();
let app: INestApplication;
let db: Database;
let store: string;
const today = localDay(new Date(), "Africa/Cairo");
const http = () => request(app.getHttpServer());
const as = (token: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", "X-Tenant-Id": store });
const post = (body: object, token = "owner") => http().post("/v1/cost-rules").set(as(token)).send(body);

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
  await join("finance", "01201115555", "finance");
  await join("ops", "01201116666", "ops_manager");
  await join("agent", "01201117777", "agent");
});
afterAll(() => app.close());

describe("/v1/cost-rules", () => {
  it("saves rules in the store's currency, one per kind and scope, and lists what applies today", async () => {
    const pack = (await post({ kind: "packaging_per_order", amount: "7.5" }).expect(201)).body;
    expect(pack).toMatchObject({ kind: "packaging_per_order", scope: {}, amount: { amount: "7.50", currency: "EGP" }, pct: null, validFrom: today, validTo: null });
    await post({ kind: "cod_fee_pct", pct: "1.5" }).expect(201);
    await post({ kind: "payment_fee_pct", pct: "2.75", fixed: "2", scope: { method: "card" } }).expect(201);
    await post({ kind: "courier_rate", amount: "60", returnAmount: "30", scope: { courier: "Bosta", zone: "Cairo" } }).expect(201);
    await post({ kind: "courier_rate", amount: "75", scope: { courier: "bosta" } }).expect(201);

    const { body } = await http().get("/v1/cost-rules").set(as("ops")).expect(200);
    expect(body).toMatchObject({ baseCurrency: "EGP", today });
    expect(body.data).toHaveLength(5);
    const card = body.data.find((r: { kind: string }) => r.kind === "payment_fee_pct");
    expect(card).toMatchObject({ pct: "2.75", fixed: { amount: "2.00", currency: "EGP" }, scope: { method: "card" } });
    const cairo = body.data.find((r: { scope: { zone?: string } }) => r.scope.zone === "cairo");
    expect(cairo).toMatchObject({ scope: { courier: "bosta", zone: "cairo" }, amount: { amount: "60.00" }, returnAmount: { amount: "30.00" } });
  });

  it("a change starts a new version and closes the old one the day before; history keeps both", async () => {
    const next = addDays(today, 3);
    await post({ kind: "packaging_per_order", amount: "9", validFrom: next }).expect(201);
    const history = (await http().get("/v1/cost-rules?history=true").set(as("owner")).expect(200)).body.data
      .filter((r: { kind: string }) => r.kind === "packaging_per_order");
    expect(history.map((r: { amount: { amount: string }; validFrom: string; validTo: string | null }) => [r.amount.amount, r.validFrom, r.validTo]))
      .toEqual([["9.00", next, null], ["7.50", today, addDays(next, -1)]]);
    // What applied on a given day.
    const later = (await http().get(`/v1/cost-rules?at=${next}`).set(as("owner")).expect(200)).body.data;
    expect(later.find((r: { kind: string }) => r.kind === "packaging_per_order").amount.amount).toBe("9.00");
    // An earlier start than an existing later version is refused; a same-day change corrects in place.
    expect((await post({ kind: "packaging_per_order", amount: "8", validFrom: addDays(today, 1) }).expect(409)).body.code).toBe("later_version_exists");
    const fixed = (await post({ kind: "packaging_per_order", amount: "9.25", validFrom: next }).expect(201)).body;
    expect(fixed.amount.amount).toBe("9.25");
    const again = (await http().get("/v1/cost-rules?history=true").set(as("owner")).expect(200)).body.data.filter((r: { kind: string }) => r.kind === "packaging_per_order");
    expect(again).toHaveLength(2);
  });

  it("resolve() gives the most specific rule that applies on the order's day", async () => {
    const rules = app.get(CostRulesService);
    const pick = (kind: Parameters<CostRulesService["resolve"]>[1], facts: Record<string, string>, day = today) =>
      db.tenant(store, (trx) => rules.resolve(trx, kind, facts, day));
    expect((await pick("courier_rate", { courier: "bosta", zone: "cairo" }))?.amount?.amount).toBe("60.00");
    expect((await pick("courier_rate", { courier: "BOSTA", zone: "giza" }))?.amount?.amount).toBe("75.00");
    expect(await pick("courier_rate", { courier: "aramex" })).toBeNull();
    expect((await pick("payment_fee_pct", { method: "card" }))?.pct).toBe("2.75");
    expect(await pick("payment_fee_pct", { method: "wallet" })).toBeNull();
    expect((await pick("cod_fee_pct", { courier: "bosta" }))?.pct).toBe("1.5"); // an unscoped rule fits any courier
    expect((await pick("packaging_per_order", {}, addDays(today, 3)))?.amount?.amount).toBe("9.25");
    expect((await pick("packaging_per_order", {}, addDays(today, -1)))).toBeNull(); // nothing applied before today
  });

  it("ends a rule after today, withdraws one that has not started, and audits every change with an event", async () => {
    const list = (await http().get("/v1/cost-rules?history=true").set(as("owner")).expect(200)).body.data;
    const cod = list.find((r: { kind: string }) => r.kind === "cod_fee_pct");
    const future = list.find((r: { kind: string; validFrom: string }) => r.kind === "packaging_per_order" && r.validFrom > today);
    await http().delete(`/v1/cost-rules/${cod.id}`).set(as("finance")).expect(204);
    await http().delete(`/v1/cost-rules/${future.id}`).set(as("finance")).expect(204);
    const after = (await http().get("/v1/cost-rules?history=true").set(as("owner")).expect(200)).body.data;
    expect(after.find((r: { id: string }) => r.id === cod.id).validTo).toBe(today);
    expect(after.find((r: { id: string }) => r.id === future.id)).toBeUndefined();
    await http().delete("/v1/cost-rules/00000000-0000-4000-8000-000000000000").set(as("owner")).expect(404);

    const audits = await db.tenant(store, (trx) => trx.selectFrom("audit_log").select("action").where("action", "=", "cost_rule.changed").execute());
    expect(audits.length).toBe(9); // 6 saves + 1 correction + 2 ends
    const events = await db.tenant(store, (trx) => trx.selectFrom("domain_events").select(["type", "data"]).where("type", "=", "costs.changed").execute());
    expect(events).toHaveLength(9);
  });

  it("validates by kind and refuses other roles", async () => {
    const bad = async (body: object) => expect((await post(body).expect(422)).body.code).toBe("validation_failed");
    await bad({ kind: "cod_fee_pct", pct: "101" });
    await bad({ kind: "cod_fee_pct", amount: "5" });
    await bad({ kind: "courier_rate", amount: "60" }); // courier required
    await bad({ kind: "packaging_per_order", amount: "-1" });
    await bad({ kind: "payment_fee_pct", pct: "2", scope: { method: "cash" } });
    await bad({ kind: "packaging_per_order", amount: "5", scope: { anything: "x" } });
    await bad({ kind: "packaging_per_order", amount: "5", validFrom: addDays(today, -200) });
    expect((await post({ kind: "packaging_per_order", amount: "5" }, "ops").expect(403)).body.code).toBe("insufficient_role");
    await http().get("/v1/cost-rules").set(as("agent")).expect(403);
    await post({ kind: "agent_per_order", amount: "12" }, "finance").expect(201);
  });
});

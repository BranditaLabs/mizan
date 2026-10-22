import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import { defaultRuntime, silentLogger, type FetchFn } from "@mizan/engine";
import { asWorker } from "@mizan/db";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { MetricsService } from "../src/platform/metrics/metrics.service.js";
import { FakeFxSource, OpenErApiSource, rateText } from "../src/modules/profit/fx/fx-source.js";
import { FxService } from "../src/modules/profit/fx/fx.service.js";
import { localDay } from "../src/modules/profit/store-day.js";
import { FakeVerifier } from "./support/fake-auth.js";

/** E9-1: daily rates from a feed (USD-based, cross rates), a store's own rates, and the lookup order. */
const fake = new FakeVerifier();
let app: INestApplication;
let db: Database;
let fx: FxService;
let store: string;
const today = localDay(new Date(), "Africa/Cairo");
const http = () => request(app.getHttpServer());
const as = (token: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", "X-Tenant-Id": store });
const rate = (quote: string, day: string, base = "EGP") => db.tenant(store, (trx) => fx.rate(trx, store, base, quote, day));
const feedRows = (day: string) => asWorker(db.kysely, (trx) => trx.selectFrom("fx_rates").selectAll().where("day", "=", new Date(`${day}T00:00:00Z`)).execute());

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "http://localhost:3000" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  db = app.get(Database);
  fx = app.get(FxService);
  fake.add("owner", { uid: "fb-owner", email: "owner@nile.test", emailVerified: true, secondFactor: "phone" });
  store = (await http().post("/v1/tenants").set({ Authorization: "Bearer owner" }).send({ name: "Nile Abayas", country: "EG" }).expect(201)).body.id;
  const inv = await http().post("/v1/members/invite").set(as("owner")).send({ phone: "01201117777", role: "agent" }).expect(201);
  fake.add("agent", { uid: "fb-agent", phone: inv.body.phone });
  await http().post(`/v1/invitations/${inv.body.id}/accept`).set({ Authorization: "Bearer agent" }).expect(200);
});
afterAll(() => app.close());

describe("daily refresh", () => {
  it("is off in tests unless a source is given; stores the feed's day once, then skips", async () => {
    expect(fx.source).toBeNull();
    expect(await fx.refresh()).toEqual({ stored: 0, skipped: true });
    const source = new FakeFxSource({ USD: "1", EGP: "48.75", SAR: "3.75", KWD: "0.307", EUR: "0.92" }, "2026-10-20");
    const first = await fx.refresh(new Date("2026-10-20T06:00:00Z"), source);
    expect(first).toEqual({ stored: 4, skipped: false });
    expect(await fx.refresh(new Date("2026-10-20T07:00:00Z"), source)).toEqual({ stored: 0, skipped: true });
    expect(source.calls).toBe(1);
    expect((await feedRows("2026-10-20")).map((r) => [r.base.trim(), r.quote.trim(), String(r.rate).replace(/0+$/, "")]).sort())
      .toEqual([["USD", "EGP", "48.75"], ["USD", "EUR", "0.92"], ["USD", "KWD", "0.307"], ["USD", "SAR", "3.75"]]);
  });

  it("keeps stored rates and counts the failure when the feed is down", async () => {
    const metrics = app.get(MetricsService);
    const before = (await metrics.fxRefresh.get()).values.find((v) => v.labels.result === "failed")?.value ?? 0;
    const down = new FakeFxSource({});
    down.fail = true;
    await expect(fx.refresh(new Date("2026-10-21T06:00:00Z"), down)).rejects.toThrow(/down/);
    expect((await metrics.fxRefresh.get()).values.find((v) => v.labels.result === "failed")?.value).toBe(before + 1);
    expect(await feedRows("2026-10-20")).toHaveLength(4);
  });
});

describe("lookup", () => {
  it("uses the day's feed rate, crosses through USD, falls back up to 7 days (stale), then says missing", async () => {
    expect(await rate("USD", "2026-10-20")).toEqual({ rate: "0.0205128205", source: "feed", day: "2026-10-20", stale: false });
    expect(await rate("SAR", "2026-10-20")).toEqual({ rate: "0.0769230769", source: "feed", day: "2026-10-20", stale: false });
    expect(await rate("EGP", "2026-10-20", "SAR")).toEqual({ rate: "13", source: "feed", day: "2026-10-20", stale: false });
    expect(await rate("USD", "2026-10-25")).toMatchObject({ source: "feed", day: "2026-10-20", stale: true });
    expect(await rate("USD", "2026-10-28")).toEqual({ rate: null, source: "missing", day: null, stale: false });
    expect(await rate("USD", "2026-10-19")).toMatchObject({ source: "missing" }); // never earlier than the data
    expect(await rate("EGP", "2026-10-20")).toEqual({ rate: "1", source: "same", day: "2026-10-20", stale: false });
    expect(await rate("JPY", "2026-10-20")).toMatchObject({ source: "missing" });
  });

  it("converts an order amount into the store's currency without floats", async () => {
    const r = await db.tenant(store, (trx) => fx.toBase(trx, store, "EGP", { amount: "100.00", currency: "USD" }, "2026-10-20"));
    expect(r?.money).toEqual({ amount: "4875.00", currency: "EGP" });
    expect(await db.tenant(store, (trx) => fx.toBase(trx, store, "EGP", { amount: "1.00", currency: "JPY" }, "2026-10-20"))).toBeNull();
  });
});

describe("/v1/fx-rates", () => {
  it("lets finance set the store's own rate for a day, which wins over the feed, audited", async () => {
    const put = (day: string, quote: string, body: object, token = "owner") => http().put(`/v1/fx-rates/${day}/${quote}`).set(as(token)).send(body);
    expect((await put("2026-10-20", "usd", { rate: "0.0200" }).expect(200)).body).toEqual({ quote: "USD", rate: "0.02", source: "manual", day: "2026-10-20", stale: false });
    expect(await rate("USD", "2026-10-20")).toEqual({ rate: "0.02", source: "manual", day: "2026-10-20", stale: false });
    expect(await rate("USD", "2026-10-21")).toMatchObject({ source: "feed", stale: true }); // the override is for its day only
    await put("2026-10-20", "USD", { rate: "0" }).expect(422);
    await put("2026-10-20", "EGP", { rate: "1" }).expect(422); // own currency
    await put("2999-01-01", "USD", { rate: "0.02" }).expect(422); // future
    await put("2026-10-20", "USD", { rate: "0.02" }, "agent").expect(403);
    const audit = await db.tenant(store, (trx) => trx.selectFrom("audit_log").select(["action", "after"]).where("action", "=", "fx.rate_overridden").execute());
    expect(audit).toHaveLength(1);
    expect(audit[0]!.after).toMatchObject({ base: "EGP", quote: "USD", day: "2026-10-20", rate: "0.0200" });
  });

  it("lists the base against USD and the currencies the store's orders use", async () => {
    const { body } = await http().get("/v1/fx-rates?day=2026-10-20").set(as("owner")).expect(200);
    expect(body).toEqual({ base: "EGP", day: "2026-10-20", feed: null, rates: [{ quote: "USD", rate: "0.02", source: "manual", day: "2026-10-20", stale: false }] });
    expect((await http().get("/v1/fx-rates").set(as("owner")).expect(200)).body.day).toBe(today);
    await http().get("/v1/fx-rates").set(as("agent")).expect(403);
  });
});

describe("open.er-api.com source", () => {
  const rt = (body: unknown, status = 200) => defaultRuntime({
    logger: silentLogger,
    fetch: (async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as FetchFn,
  });

  it("parses the feed into decimal strings for the feed's own day", async () => {
    const source = new OpenErApiSource(rt({ result: "success", base_code: "USD", time_last_update_unix: 1792540921, rates: { USD: 1, EGP: 48.7512, KWD: 0.30712345678, xx: 3 } }));
    expect(await source.latest("USD")).toEqual({ day: "2026-10-21", base: "USD", rates: { USD: "1", EGP: "48.7512", KWD: "0.30712346" } });
    expect(source.attribution).toMatch(/ExchangeRate-API/);
  });

  it("refuses an error payload or a changed shape instead of storing it", async () => {
    await expect(new OpenErApiSource(rt({ result: "error", "error-type": "unsupported-code" })).latest("USD")).rejects.toMatchObject({ kind: "schema_drift" });
    await expect(new OpenErApiSource(rt({ result: "success", base_code: "USD", time_last_update_unix: 1, rates: { EGP: "48.75" } })).latest("USD")).rejects.toMatchObject({ kind: "schema_drift" });
    expect(() => rateText(0)).toThrow();
    expect(rateText(1e-7)).toBe("0.0000001");
  });
});

import "reflect-metadata";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { FlagsService } from "../src/modules/flags/flags.service.js";
import { FakeVerifier } from "./support/fake-auth.js";

/**
 * A-6: staff turn features on for everyone or for one store (the store's setting wins) and post
 * announcements to every store or to some plans or countries; stores read both, never write them.
 */
const fake = new FakeVerifier();
let app: INestApplication;
let nile: string;
let delta: string;
const http = () => request(app.getHttpServer());
const as = (token: string, tenant?: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", ...(tenant ? { "X-Tenant-Id": tenant } : {}) });
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test", PLATFORM_BOOTSTRAP_EMAILS: "boss@mizan.test" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  fake.add("boss", { uid: "fb-boss-a6", email: "boss@mizan.test", emailVerified: true, secondFactor: "totp" });
  fake.add("help", { uid: "fb-help-a6", email: "help@mizan.test", emailVerified: true, secondFactor: "totp" });
  fake.add("owner", { uid: "fb-owner-a6", email: "owner@nile.test", emailVerified: true, secondFactor: "phone" });
  fake.add("owner2", { uid: "fb-owner2-a6", email: "owner@delta.test", emailVerified: true, secondFactor: "phone" });
  nile = (await http().post("/v1/tenants").set(as("owner")).send({ name: "Nile Abayas", country: "EG" }).expect(201)).body.id;
  delta = (await http().post("/v1/tenants").set(as("owner2")).send({ name: "Delta Perfumes", country: "SA" }).expect(201)).body.id;
  await http().get("/v1/me").set(as("help")).expect(200);
  await http().get("/v1/platform/me").set(as("boss")).expect(200);
  await http().post("/v1/platform/staff").set(as("boss")).send({ email: "help@mizan.test", role: "support" }).expect(201);
});
afterAll(() => app.close());

describe("feature flags (A-6)", () => {
  it("are off until turned on; a store's own setting wins; stores only read them", async () => {
    expect((await http().get("/v1/flags").set(as("owner", nile)).expect(200)).body).toEqual({ flags: {} });
    await http().put("/v1/platform/flags/new.returns_screen").set(as("help")).send({ enabled: true }).expect(403);
    await http().put("/v1/platform/flags/Bad Key").set(as("boss")).send({ enabled: true }).expect(422);
    const f = (await http().put("/v1/platform/flags/new.returns_screen").set(as("boss")).send({ enabled: false, description: "The new returns screen" }).expect(200)).body;
    expect(f).toMatchObject({ key: "new.returns_screen", enabled: false, description: "The new returns screen", stores: [] });
    expect((await http().get("/v1/flags").set(as("owner", nile)).expect(200)).body.flags).toEqual({ "new.returns_screen": false });

    const pilot = (await http().put(`/v1/platform/flags/new.returns_screen/stores/${nile}`).set(as("boss")).send({ enabled: true }).expect(200)).body;
    expect(pilot.stores).toEqual([{ storeId: nile, storeName: "Nile Abayas", enabled: true }]);
    expect((await http().get("/v1/flags").set(as("owner", nile)).expect(200)).body.flags["new.returns_screen"]).toBe(true);
    expect((await http().get("/v1/flags").set(as("owner2", delta)).expect(200)).body.flags["new.returns_screen"]).toBe(false);
    expect(await app.get(FlagsService).isEnabled(nile, "new.returns_screen")).toBe(true);
    expect(await app.get(FlagsService).isEnabled(nile, "never.made")).toBe(false);

    // Everyone on, except a store that opted out.
    await http().put("/v1/platform/flags/new.returns_screen").set(as("boss")).send({ enabled: true }).expect(200);
    await http().put(`/v1/platform/flags/new.returns_screen/stores/${delta}`).set(as("boss")).send({ enabled: false }).expect(200);
    expect((await http().get("/v1/flags").set(as("owner2", delta)).expect(200)).body.flags["new.returns_screen"]).toBe(false);
    await http().delete(`/v1/platform/flags/new.returns_screen/stores/${delta}`).set(as("boss")).expect(200);
    expect((await http().get("/v1/flags").set(as("owner2", delta)).expect(200)).body.flags["new.returns_screen"]).toBe(true);

    await http().put(`/v1/platform/flags/nope.flag/stores/${nile}`).set(as("boss")).send({ enabled: true }).expect(404);
    expect((await http().get("/v1/platform/flags").set(as("help")).expect(200)).body.data).toHaveLength(1);
    await http().delete("/v1/platform/flags/new.returns_screen").set(as("boss")).expect(204);
    expect((await http().get("/v1/flags").set(as("owner", nile)).expect(200)).body.flags).toEqual({});
    await http().delete("/v1/platform/flags/new.returns_screen").set(as("boss")).expect(404);
  });
});

describe("announcements (A-6)", () => {
  it("reach the stores they target, most serious first, until they end", async () => {
    await http().post("/v1/platform/announcements").set(as("help")).send({ titleAr: "x", titleEn: "x", endsAt: day(-1) }).expect(422);
    await http().post("/v1/platform/announcements").set(as("help")).send({ titleAr: "x", titleEn: "x", endsAt: day(1), link: "http://insecure.test" }).expect(422);
    const all = (await http().post("/v1/platform/announcements").set(as("help"))
      .send({ titleAr: "تحديث جديد", titleEn: "New update", bodyAr: "شاشة المرتجعات الجديدة", bodyEn: "The new returns screen", endsAt: day(3), link: "https://mizan.app/news" }).expect(201)).body;
    const ksa = (await http().post("/v1/platform/announcements").set(as("boss"))
      .send({ level: "critical", titleAr: "صيانة الليلة", titleEn: "Maintenance tonight", countries: ["SA"], endsAt: day(1) }).expect(201)).body;
    await http().post("/v1/platform/announcements").set(as("boss")).send({ titleAr: "قريباً", titleEn: "Soon", startsAt: day(1), endsAt: day(2) }).expect(201);
    await http().post("/v1/platform/announcements").set(as("boss")).send({ titleAr: "للنمو", titleEn: "Growth only", plans: ["growth"], endsAt: day(2) }).expect(201);

    expect((await http().get("/v1/announcements").set(as("owner", nile)).expect(200)).body.data)
      .toEqual([{ id: all.id, level: "info", titleAr: "تحديث جديد", titleEn: "New update", bodyAr: "شاشة المرتجعات الجديدة", bodyEn: "The new returns screen", link: "https://mizan.app/news", endsAt: all.endsAt }]);
    const d = (await http().get("/v1/announcements").set(as("owner2", delta)).expect(200)).body.data; // in KSA
    expect(d.map((a: { titleEn: string }) => a.titleEn)).toEqual(["Maintenance tonight", "New update"]);

    expect((await http().post(`/v1/platform/announcements/${ksa.id}/end`).set(as("boss")).expect(200)).body.endsAt <= new Date().toISOString()).toBe(true);
    expect((await http().get("/v1/announcements").set(as("owner2", delta)).expect(200)).body.data.map((a: { id: string }) => a.id)).toEqual([all.id]);
    expect((await http().get("/v1/platform/announcements?live=true").set(as("help")).expect(200)).body.data).toHaveLength(3);
    expect((await http().get("/v1/platform/announcements").set(as("help")).expect(200)).body.data).toHaveLength(4);
    await http().post(`/v1/platform/announcements/${crypto.randomUUID()}/end`).set(as("boss")).expect(404);
  });
});

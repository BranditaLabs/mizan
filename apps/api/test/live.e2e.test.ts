import "reflect-metadata";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import type { DomainEventType } from "@mizan/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { EventsService } from "../src/platform/events/events.service.js";
import { LiveHub } from "../src/platform/live/live.hub.js";
import { FakeVerifier } from "./support/fake-auth.js";

/**
 * LV-1a: GET /v1/live streams what changes in one store (SSE), opened with a single-use token
 * from POST /v1/live/token. Only the store's own events reach it; the token never reaches a log.
 */
const fake = new FakeVerifier();
let app: INestApplication;
let base: string;
let shop: string;
let other: string;
let whUser: string;
const logs: string[] = [];
const http = () => request(app.getHttpServer());
const as = (token: string, tenant?: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", ...(tenant ? { "X-Tenant-Id": tenant } : {}) });
const ORDER = "0b6f3f9e-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
const SHIPMENT = "1b6f3f9e-1c2d-4e5f-8a9b-0c1d2e3f4a5b";

interface Frame { event: string; data: unknown; id?: string }
interface Stream {
  status: number;
  headers: IncomingHttpHeaders;
  frames: Frame[];
  comments: number;
  body: string;
  closed: boolean;
  next(event: string, match?: (data: any) => boolean, timeoutMs?: number): Promise<Frame>;
  close(): void;
}

/** Open GET /v1/live with a plain HTTP client and parse SSE frames as they arrive. */
function open(path: string, headers: Record<string, string> = {}): Promise<Stream> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(`${base}${path}`, { headers: { Accept: "text/event-stream", Origin: "https://app.mizan.test", ...headers } }, (res) => {
      let buf = "";
      const waiters = new Set<() => boolean>();
      const s: Stream = {
        status: res.statusCode ?? 0, headers: res.headers, frames: [], comments: 0, body: "", closed: false,
        next(event, match = () => true, timeoutMs = 5000) {
          let seen = 0;
          return new Promise((ok, fail) => {
            const check = (): boolean => {
              for (; seen < s.frames.length; seen++) {
                const f = s.frames[seen]!;
                if (f.event === event && match(f.data)) { clearTimeout(timer); ok(f); return true; }
              }
              if (s.closed) { clearTimeout(timer); fail(new Error(`stream closed before ${event}`)); return true; }
              return false;
            };
            const timer = setTimeout(() => { waiters.delete(check); fail(new Error(`no ${event} within ${timeoutMs} ms; got ${JSON.stringify(s.frames)}`)); }, timeoutMs);
            if (!check()) waiters.add(check);
          });
        },
        close: () => req.destroy(),
      };
      const wake = () => { for (const w of [...waiters]) if (w()) waiters.delete(w); };
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        s.body += chunk;
        buf += chunk;
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (block.startsWith(":")) { s.comments++; continue; }
          const f: Frame = { event: "message", data: undefined };
          for (const line of block.split("\n")) {
            const [k, ...v] = line.split(": ");
            if (k === "event") f.event = v.join(": ");
            else if (k === "id") f.id = v.join(": ");
            else if (k === "data") f.data = JSON.parse(v.join(": "));
          }
          s.frames.push(f);
        }
        wake();
      });
      res.on("close", () => { s.closed = true; wake(); });
      resolve(s);
    });
    req.on("error", (e) => (e.message.includes("socket hang up") ? undefined : reject(e)));
    req.end();
  });
}

async function mint(token: string, tenant: string, topics: string[]) {
  return (await http().post("/v1/live/token").set(as(token, tenant)).send({ topics }).expect(201)).body as { token: string; url: string; topics: string[]; expiresAt: string };
}

async function emit(tenant: string, type: DomainEventType, entity: { type: string; id: string }, data: Record<string, unknown> = {}) {
  return app.get(Database).tenant(tenant, (trx) => app.get(EventsService).emit(trx, { type, tenantId: tenant, entity, data }));
}

const until = async (ok: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
};

beforeAll(async () => {
  const config = loadConfig({
    NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test", PLATFORM_BOOTSTRAP_EMAILS: "boss@mizan.test",
    LIVE_POLL_MS: "100", LIVE_HEARTBEAT_MS: "250", LIVE_RECHECK_MS: "200", LIVE_MAX_STREAM_MS: "20000", AUTH_MEMBERSHIP_CACHE_MS: "0",
  });
  app = await createApp(config, { logDestination: new Writable({ write: (c, _e, d) => { logs.push(String(c)); d(); } }), tokenVerifier: fake });
  await app.listen(0, "127.0.0.1");
  base = (await app.getUrl()).replace("[::1]", "127.0.0.1");
  fake.add("owner", { uid: "fb-owner-lv1", email: "owner@nile.test", emailVerified: true, secondFactor: "phone" });
  fake.add("rival", { uid: "fb-rival-lv1", email: "owner@delta.test", emailVerified: true, secondFactor: "phone" });
  fake.add("boss", { uid: "fb-boss-lv1", email: "boss@mizan.test", emailVerified: true, secondFactor: "totp" });
  fake.add("help", { uid: "fb-help-lv1", email: "help@mizan.test", emailVerified: true, secondFactor: "phone" });
  shop = (await http().post("/v1/tenants").set(as("owner")).send({ name: "Nile Live", country: "EG" }).expect(201)).body.id;
  other = (await http().post("/v1/tenants").set(as("rival")).send({ name: "Delta Live", country: "EG" }).expect(201)).body.id;
  const inv = await http().post("/v1/members/invite").set(as("owner", shop)).send({ phone: "01201118882", role: "warehouse" }).expect(201);
  fake.add("wh", { uid: "fb-wh-lv1", phone: inv.body.phone });
  await http().post(`/v1/invitations/${inv.body.id}/accept`).set(as("wh")).expect(200);
  whUser = (await app.get(Database).platform((trx) => trx.selectFrom("users").select("id").where("firebase_uid", "=", "fb-wh-lv1").executeTakeFirstOrThrow())).id;
  await http().get("/v1/me").set(as("help")).expect(200);
  await http().get("/v1/platform/me").set(as("boss")).expect(200);
  await http().post("/v1/platform/staff").set(as("boss")).send({ email: "help@mizan.test", role: "support" }).expect(201);
}, 120_000);
afterAll(() => app?.close());

describe("live token (LV-1a)", () => {
  it("is minted for the caller's store and topics; unknown topics and topics the role cannot read are refused", async () => {
    const t = await mint("owner", shop, ["orders", `order:${ORDER.toUpperCase()}`, "orders", "notifications"]);
    expect(t.topics).toEqual(["orders", `order:${ORDER}`, "notifications"]);
    expect(t.token).toMatch(new RegExp(`^${shop}\\.[A-Za-z0-9_-]{43}$`));
    expect(Date.parse(t.expiresAt) - Date.now()).toBeLessThanOrEqual(60_000);
    expect(t.url).toBe(`/v1/live?topics=${encodeURIComponent(t.topics.join(","))}&token=${encodeURIComponent(t.token)}`);
    // Only the hash is stored.
    const rows = await app.get(Database).tenant(shop, (trx) => trx.selectFrom("live_tokens").selectAll().execute());
    expect(JSON.stringify(rows)).not.toContain(t.token.split(".")[1]);

    expect((await http().post("/v1/live/token").set(as("owner", shop)).send({ topics: ["payments"] }).expect(422)).body.code).toBe("unknown_topic");
    expect((await http().post("/v1/live/token").set(as("wh", shop)).send({ topics: ["refunds"] }).expect(403)).body.code).toBe("topic_not_allowed");
    await http().post("/v1/live/token").set(as("wh", shop)).send({ topics: ["orders", "shipments", "notifications"] }).expect(201);
    await http().post("/v1/live/token").set(as("owner", shop)).send({ topics: [] }).expect(422);
    await http().post("/v1/live/token").set(as("owner")).send({ topics: ["orders"] }).expect(400);
    await http().post("/v1/live/token").send({ topics: ["orders"] }).expect(401);
    expect((await http().post("/v1/live/token").set(as("rival", shop)).send({ topics: ["orders"] }).expect(403)).body.code).toBe("not_a_member");
  });
});

describe("live stream (LV-1a)", () => {
  it("streams the store's changes under the token's topics, uncompressed, with heartbeats", async () => {
    const t = await mint("owner", shop, ["orders", "shipments", "connections", "notifications"]);
    const s = await open(t.url, { "Accept-Encoding": "gzip, deflate, br" });
    expect(s.status).toBe(200);
    expect(s.headers["content-type"]).toBe("text/event-stream; charset=utf-8");
    expect(s.headers["content-encoding"]).toBeUndefined();
    expect(s.headers["cache-control"]).toContain("no-transform");
    expect(s.headers["x-accel-buffering"]).toBe("no");
    expect(s.headers["access-control-allow-origin"]).toBe("https://app.mizan.test");
    expect(s.headers["x-request-id"]).toBeTruthy();
    const ready = await s.next("ready", undefined, 2000);
    expect(ready.data).toMatchObject({ topics: ["orders", "shipments", "connections", "notifications"], heartbeatMs: 250 });

    const started = Date.now();
    const created = await emit(shop, "order.created", { type: "order", id: ORDER });
    const c = await s.next("change", (d) => d.id === created, 2000);
    expect(Date.now() - started).toBeLessThan(2000); // unbuffered
    expect(c.id).toBe(created);
    expect(c.data).toEqual({ id: created, type: "order.created", topics: ["orders"], entity: { type: "order", id: ORDER }, orderId: ORDER, at: expect.any(String) });

    const moved = await emit(shop, "shipment.status_changed", { type: "shipment", id: SHIPMENT }, { orderId: ORDER, status: "in_transit" });
    expect((await s.next("change", (d) => d.id === moved)).data).toMatchObject({ type: "shipment.status_changed", topics: ["shipments"], orderId: ORDER, entity: { type: "shipment", id: SHIPMENT } });
    const conn = await emit(shop, "connection.needs_attention", { type: "connection", id: SHIPMENT });
    expect((await s.next("change", (d) => d.id === conn)).data).toMatchObject({ topics: ["connections"] });

    const note = await app.get(Database).tenant(shop, (trx) => trx.insertInto("notifications")
      .values({ tenant_id: shop, roles: ["owner", "admin"], text: "Bosta needs you", source: "platform", entity_type: "order", entity_id: ORDER })
      .returning("id").executeTakeFirstOrThrow());
    expect((await s.next("change", (d) => d.id === note.id)).data).toEqual({ id: note.id, type: "notification.created", topics: ["notifications"], entity: { type: "order", id: ORDER }, orderId: ORDER, at: expect.any(String) });
    // Events no topic of the stream covers are not sent; the record itself never is.
    await emit(shop, "stock.low", { type: "variant", id: SHIPMENT });
    await until(() => s.comments >= 2);
    expect(s.frames.filter((f) => f.event === "change").map((f) => (f.data as { type: string }).type)).toEqual(["order.created", "shipment.status_changed", "connection.needs_attention", "notification.created"]);
    expect(s.body).not.toContain("Bosta needs you");
    expect(s.body).not.toContain("in_transit");
    s.close();
    await until(() => app.get(LiveHub).open === 0);
  });

  it("sends nothing from another store, and only notifications for the person's role", async () => {
    const mine = await open((await mint("wh", shop, ["orders", "notifications"])).url);
    await mine.next("ready");
    const theirs = await open((await mint("rival", other, ["orders", "notifications"])).url);
    await theirs.next("ready");
    const a = await emit(shop, "order.updated", { type: "order", id: ORDER });
    const b = await emit(other, "order.updated", { type: "order", id: SHIPMENT });
    await app.get(Database).tenant(shop, (trx) => trx.insertInto("notifications")
      .values({ tenant_id: shop, roles: ["owner"], text: "owners only", source: "platform" }).execute());
    const warehouse = await app.get(Database).tenant(shop, (trx) => trx.insertInto("notifications")
      .values({ tenant_id: shop, roles: ["warehouse"], text: "pack it", source: "platform" }).returning("id").executeTakeFirstOrThrow());
    await mine.next("change", (d) => d.id === a);
    await mine.next("change", (d) => d.id === warehouse.id);
    await theirs.next("change", (d) => d.id === b);
    await new Promise((r) => setTimeout(r, 400));
    expect(mine.frames.filter((f) => f.event === "change").map((f) => f.id)).toEqual([a, warehouse.id]);
    expect(theirs.frames.filter((f) => f.event === "change").map((f) => f.id)).toEqual([b]);
    mine.close();
    theirs.close();
  });

  it("follows one order", async () => {
    const s = await open((await mint("owner", shop, [`order:${ORDER}`])).url);
    await s.next("ready");
    await emit(shop, "order.updated", { type: "order", id: SHIPMENT });
    const shipped = await emit(shop, "shipment.created", { type: "shipment", id: SHIPMENT }, { orderId: ORDER });
    expect((await s.next("change", (d) => d.id === shipped)).data).toMatchObject({ topics: [`order:${ORDER}`] });
    await new Promise((r) => setTimeout(r, 300));
    expect(s.frames.filter((f) => f.event === "change")).toHaveLength(1);
    s.close();
  });

  it("refuses a used token, an expired one, a forged one and topics beyond the token; a new token reconnects", async () => {
    const t = await mint("owner", shop, ["orders"]);
    const first = await open(t.url);
    await first.next("ready");
    first.close();

    const again = await open(t.url);
    expect(again.status).toBe(401);
    await until(() => again.closed);
    expect(JSON.parse(again.body)).toMatchObject({ code: "live_token_used", status: 401 });

    const fresh = await open((await mint("owner", shop, ["orders"])).url);
    expect(fresh.status).toBe(200);
    await fresh.next("ready");
    const e = await emit(shop, "order.cancelled", { type: "order", id: ORDER });
    await fresh.next("change", (d) => d.id === e);
    fresh.close();

    const stale = await mint("owner", shop, ["orders"]);
    await app.get(Database).tenant(shop, (trx) => trx.updateTable("live_tokens").set({ expires_at: new Date(Date.now() - 1000) }).where("used_at", "is", null).execute());
    const late = await open(stale.url);
    await until(() => late.closed);
    expect([late.status, JSON.parse(late.body).code]).toEqual([401, "live_token_expired"]);

    const real = await mint("owner", shop, ["orders"]);
    const forged = real.token.replace(shop, other);
    const wrongStore = await open(`/v1/live?token=${encodeURIComponent(forged)}`);
    await until(() => wrongStore.closed);
    expect([wrongStore.status, JSON.parse(wrongStore.body).code]).toEqual([401, "live_token_invalid"]);
    const garbage = await open("/v1/live?token=nope");
    await until(() => garbage.closed);
    expect([garbage.status, JSON.parse(garbage.body).code]).toEqual([401, "live_token_invalid"]);
    const none = await open("/v1/live");
    await until(() => none.closed);
    expect(none.status).toBe(422);

    const wider = await open(`/v1/live?topics=orders,refunds&token=${encodeURIComponent(real.token)}`);
    await until(() => wider.closed);
    expect([wider.status, JSON.parse(wider.body).code]).toEqual([403, "topic_not_in_token"]);
  });

  it("ends the stream when the person loses access to the store", async () => {
    const s = await open((await mint("wh", shop, ["orders"])).url);
    await s.next("ready");
    await http().delete(`/v1/members/${whUser}`).set(as("owner", shop)).expect((r) => expect(r.status).toBeLessThan(300));
    expect((await s.next("end", undefined, 3000)).data).toEqual({ reason: "revoked" });
    await until(() => s.closed);
    expect((await http().post("/v1/live/token").set(as("wh", shop)).send({ topics: ["orders"] }).expect(403)).body.code).toBe("not_a_member");
  });

  it("support staff with a read-only grant may follow the store until the grant ends", async () => {
    const g = (await http().post(`/v1/platform/stores/${shop}/access`).set(as("help")).send({ reason: "watch the sync", minutes: 30 }).expect(201)).body;
    const t = await mint("help", shop, ["orders", "connections"]);
    const s = await open(t.url);
    await s.next("ready");
    await http().post(`/v1/support-access/${g.id}/end`).set(as("owner", shop)).expect(200);
    expect((await s.next("end", undefined, 3000)).data).toEqual({ reason: "revoked" });
  });

  it("never writes the token to a log line", async () => {
    const t = await mint("owner", shop, ["orders"]);
    const s = await open(t.url);
    await s.next("ready");
    s.close();
    const used = await open(t.url); // refused: logged as a 401 with its URL
    await until(() => used.closed);
    await until(() => app.get(LiveHub).open === 0);
    await new Promise((r) => setTimeout(r, 300));
    const all = logs.join("");
    expect(all).toContain("/v1/live");
    expect(all).not.toContain("token=");
    expect(all).not.toContain(t.token.split(".")[1]);
  });
});

describe("live stream lifetime (LV-1a)", () => {
  it("ends with `expired` after LIVE_MAX_STREAM_MS, and with `shutdown` when the API stops", async () => {
    const short = await createApp(loadConfig({ NODE_ENV: "test", PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test", LIVE_POLL_MS: "100", LIVE_MAX_STREAM_MS: "1000" }), {
      logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake,
    });
    await short.listen(0, "127.0.0.1");
    const url = (await short.getUrl()).replace("[::1]", "127.0.0.1");
    const req = () => request(short.getHttpServer());
    const store = (await req().post("/v1/tenants").set(as("owner")).send({ name: "Nile Short", country: "EG" }).expect(201)).body.id;
    const tok = async () => (await req().post("/v1/live/token").set(as("owner", store)).send({ topics: ["orders"] }).expect(201)).body.url as string;
    const prev = base;
    base = url;
    try {
      const s = await open(await tok());
      const ready = await s.next("ready");
      expect(Date.parse((ready.data as { endsAt: string }).endsAt) - Date.now()).toBeLessThanOrEqual(1000);
      expect((await s.next("end", undefined, 3000)).data).toEqual({ reason: "expired" });
      await until(() => s.closed);

      const s2 = await open(await tok());
      await s2.next("ready");
      const closing = short.close();
      expect((await s2.next("end", undefined, 3000)).data).toEqual({ reason: "shutdown" });
      await closing;
    } finally {
      base = prev;
    }
  });
});

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { defaultRuntime } from "./core/runtime.js";
import { MizanEngine } from "./engine/engine.js";
import { SqlStore, type SqlClient } from "./sync/sql-store.js";
import { MemoryStore, type Store } from "./sync/store.js";

/**
 * Production entry point.
 *
 *   POST /webhooks/shopify          Shopify HTTPS webhooks (HMAC-verified)
 *   POST /webhooks/bosta?token=…    Bosta delivery webhooks (shared token)
 *   GET  /health                    circuits, budgets, outbox, drift report
 *   POST /ops/jobs/:id/replay       retry a dead-lettered job after a fix      (Bearer OPS_TOKEN)
 *   POST /ops/orders/ship           { orderId }  ship an order with Bosta      (Bearer OPS_TOKEN)
 *   POST /ops/cities/resolve        { text, cityId, jobId? }  teach a city     (Bearer OPS_TOKEN)
 *
 * A worker loop runs due outbox jobs every second; reconciliation polls are
 * scheduled every five minutes. Run several instances against one database:
 * job claiming is lock-free and lease-based.
 */

const env = (k: string, fallback?: string) => {
  const v = process.env[k] ?? fallback;
  if (v === undefined) throw new Error(`Missing environment variable ${k}`);
  return v;
};

async function makeStore(): Promise<Store> {
  if (!process.env.DATABASE_URL) {
    console.warn("DATABASE_URL not set: using in-memory store (state is lost on restart). Do not run like this in production.");
    return new MemoryStore();
  }
  const pg = (await import("pg" as string)) as { default: { Pool: new (o: { connectionString: string }) => SqlClient } };
  const store = new SqlStore(new pg.default.Pool({ connectionString: process.env.DATABASE_URL }));
  await store.migrate();
  return store;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 2 * 1024 * 1024) reject(new Error("body too large"));
      else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function opsAuthorized(req: IncomingMessage): boolean {
  const want = process.env.OPS_TOKEN;
  const got = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  if (!want || !got) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function main() {
  const rt = defaultRuntime();
  const store = await makeStore();
  const publicUrl = env("PUBLIC_URL").replace(/\/$/, "");
  const engine = new MizanEngine(store, rt, {
    shopify: {
      shop: env("SHOPIFY_SHOP"),
      accessToken: env("SHOPIFY_ACCESS_TOKEN"),
      apiVersion: env("SHOPIFY_API_VERSION", "2026-10"),
      clientSecret: env("SHOPIFY_CLIENT_SECRET"),
    },
    bosta: {
      apiKey: env("BOSTA_API_KEY"),
      baseUrl: process.env.BOSTA_BASE_URL,
      webhookSecret: env("BOSTA_WEBHOOK_SECRET"),
      webhookUrl: `${publicUrl}/webhooks/bosta`,
      trackingUrlTemplate: process.env.BOSTA_TRACKING_URL_TEMPLATE,
    },
    locationId: process.env.SHOPIFY_LOCATION_ID,
    autoShipTag: process.env.AUTO_SHIP_TAG ?? "mizan-confirmed",
  });
  await engine.init();

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://local");
      const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
      if (req.method === "POST" && url.pathname === "/webhooks/shopify") {
        const r = await engine.handleShopifyWebhook(headers, await readBody(req));
        return send(res, r.status, r.body);
      }
      if (req.method === "POST" && url.pathname === "/webhooks/bosta") {
        const r = await engine.handleBostaWebhook(Object.fromEntries(url.searchParams), headers, await readBody(req));
        return send(res, r.status, r.body);
      }
      if (req.method === "GET" && url.pathname === "/health") return send(res, 200, await engine.health());

      if (url.pathname.startsWith("/ops/")) {
        if (!opsAuthorized(req)) return send(res, 401, { error: "unauthorized" });
        const replay = url.pathname.match(/^\/ops\/jobs\/([0-9a-f-]+)\/replay$/);
        if (req.method === "POST" && replay) return send(res, 200, { replayed: await engine.replay(replay[1]) });
        const body = JSON.parse((await readBody(req)) || "{}");
        if (req.method === "POST" && url.pathname === "/ops/orders/ship") return send(res, 202, await engine.shipOrder(String(body.orderId)));
        if (req.method === "POST" && url.pathname === "/ops/cities/resolve") return send(res, 200, { ok: await engine.resolveCity(String(body.text), String(body.cityId), body.jobId) });
      }
      send(res, 404, { error: "not found" });
    } catch (e) {
      rt.logger.log("error", "http handler failed", { error: e instanceof Error ? e.message : String(e) });
      send(res, 500, { error: "internal error" });
    }
  });

  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await engine.worker.tick();
    } catch (e) {
      rt.logger.log("error", "worker tick failed", { error: e instanceof Error ? e.message : String(e) });
    } finally {
      busy = false;
    }
  }, 1_000);
  setInterval(() => engine.scheduleReconcile().catch(() => undefined), 5 * 60_000);
  await engine.scheduleReconcile();

  const port = Number(process.env.PORT ?? 8080);
  server.listen(port, () => rt.logger.log("info", "mizan engine listening", { port }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Load tests (H-11) against the real API on PostgreSQL. Targets are the 10× plan
 * (docs/10 E16): webhook bursts of 500/s acknowledged with p95 < 200 ms, API p95 < 300 ms.
 *
 *   npm run build && TEST_DATABASE_URL=postgres://… npm run load -w @mizan/perf
 *
 * Model: LOAD_INSTANCES API processes (default 2, the production minimum on Cloud Run, one
 * vCPU each) on one database; each scenario's rate is split evenly across them, as the load
 * balancer does. Merged result: summed req/s, worst percentile of any instance.
 *
 * Env: LOAD_TENANTS (2000), LOAD_DURATION seconds per scenario (30), LOAD_OUT (write the
 * JSON report there), LOAD_ONLY (comma-separated scenario names), LOAD_NODE_ARGS (extra
 * flags for the API process, e.g. "--cpu-prof --cpu-prof-dir=/tmp/prof"). autocannon reports p90 and p97.5, not p95: gates use p97.5, which is stricter.
 * Exit code 1 when any gate fails, so the nightly job catches regressions.
 */
import { spawn } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import autocannon from "autocannon";
import pg from "pg";
import { migrate, pgMigrationClient } from "@mizan/db";

const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("TEST_DATABASE_URL is required");
const TENANTS = Number(process.env.LOAD_TENANTS ?? 2000);
const DURATION = Number(process.env.LOAD_DURATION ?? 30);
const SECRET = randomUUID();

interface Gate { p975Ms: number; minRps?: number }
interface Scenario { name: string; what: string; gate: Gate | null; opts: autocannon.Options }
interface Row { name: string; what: string; sent: number; rps: number; p50: number; p90: number; p975: number; p99: number; max: number; non2xx: number; errors: number; timeouts: number; pass: boolean | null; why: string[] }

const name = `mizan_load_${process.pid}`;
const admin = new pg.Client({ connectionString: base });
await admin.connect();
await admin.query(`CREATE DATABASE ${name}`);
const dbUrl = Object.assign(new URL(base), { pathname: `/${name}` }).toString();
const INSTANCES = Number(process.env.LOAD_INSTANCES ?? 2);
const servers: ReturnType<typeof spawn>[] = [];
let failed = false;
try {
  const mc = await pgMigrationClient(dbUrl);
  await migrate(mc);
  await mc.close();

  // ---- start the API instances (the first one seeds) ----------------------------------
  const t0 = performance.now();
  const start = (seed: boolean) => new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, [...(process.env.LOAD_NODE_ARGS ?? "").split(" ").filter(Boolean), "--import", "tsx", fileURLToPath(new URL("./server.ts", import.meta.url))], {
      env: { ...process.env, LOAD_DATABASE_URL: dbUrl, LOAD_TENANTS: String(TENANTS), LOAD_SHOPIFY_SECRET: SECRET, LOAD_SEED: seed ? "1" : "0" },
      stdio: ["ignore", "pipe", "inherit"],
    });
    servers.push(child);
    child.stdout!.on("data", (b: Buffer) => { const m = /READY (\d+)/.exec(b.toString()); if (m) resolve(Number(m[1])); });
    child.on("exit", (code) => reject(new Error(`load server exited (${code})`)));
  });
  const ports = [await start(true)];
  for (let i = 1; i < INSTANCES; i++) ports.push(await start(false));
  console.error(`seeded ${TENANTS} stores and started ${INSTANCES} API instance(s) in ${((performance.now() - t0) / 1000).toFixed(1)} s`);

  const db = new pg.Client({ connectionString: dbUrl });
  await db.connect();
  const rows = (await db.query<{ slug: string; tenant: string; conn: string }>(
    `SELECT t.slug, t.id AS tenant, c.id AS conn FROM tenants t JOIN connections c ON c.tenant_id = t.id`)).rows;
  await db.end();
  const stores = rows.map((r) => ({ i: Number(r.slug.slice(5)), tenant: r.tenant, conn: r.conn }));
  const pick = () => stores[Math.floor(Math.random() * stores.length)]!;

  // A Shopify orders/create webhook of realistic size (~3 KB), signed like Shopify does.
  const lineItem = (n: number) => ({ id: 1e12 + n, title: `Cotton shirt ${n}`, quantity: 1 + (n % 3), price: "450.00", sku: `SKU-${n}`, variant_id: 4e12 + n, properties: [], tax_lines: [] });
  const webhook = (req: Record<string, unknown>) => {
    const s = pick();
    const id = Math.floor(Math.random() * 1e12);
    const body = JSON.stringify({
      id, admin_graphql_api_id: `gid://shopify/Order/${id}`, name: `#${id % 100000}`, updated_at: new Date().toISOString(),
      financial_status: "pending", gateway: "Cash on Delivery (COD)", currency: "EGP", total_price: "1350.00",
      shipping_address: { city: "Nasr City", province: "Cairo", country_code: "EG", address1: "12 Abbas El Akkad", zip: "11765" },
      line_items: [1, 2, 3].map(lineItem), note: "x".repeat(800),
    });
    return {
      ...req, method: "POST", path: `/webhooks/shopify/${s.conn}`, body,
      headers: {
        "content-type": "application/json", "x-shopify-topic": "orders/create", "x-shopify-shop-domain": `s${s.i}.myshopify.com`,
        "x-shopify-event-id": randomUUID(), "x-shopify-webhook-id": randomUUID(), "x-shopify-api-version": "2026-10",
        "x-shopify-hmac-sha256": createHmac("sha256", SECRET).update(body).digest("base64"),
      },
    };
  };
  const asOwner = (path: string) => (req: Record<string, unknown>) => {
    const s = pick();
    return { ...req, method: "GET", path, headers: { authorization: `Bearer u${s.i}`, "x-tenant-id": s.tenant } };
  };
  let signups = 0;
  const signup = (req: Record<string, unknown>) => ({
    ...req, method: "POST", path: "/v1/tenants",
    headers: { authorization: `Bearer new-${process.pid}-${++signups}`, "content-type": "application/json" },
    body: JSON.stringify({ name: `Signup ${signups}`, country: "EG" }),
  });

  const scenarios: Scenario[] = [
    { name: "warm-up", what: "one webhook per store (builds and caches every tenant engine)", gate: null,
      opts: { amount: TENANTS, connections: 20, requests: [{ setupRequest: webhook as never }] } },
    { name: "webhook-burst", what: "Shopify orders/create at 500/s: verify, dedupe, enqueue, 200", gate: { p975Ms: 200, minRps: 475 },
      opts: { duration: DURATION, connections: Number(process.env.LOAD_CONNECTIONS ?? 20), overallRate: Number(process.env.LOAD_WEBHOOK_RPS ?? 500), requests: [{ setupRequest: webhook as never }] } },
    { name: "reads", what: "GET /v1/members at 500/s: token, membership, RLS read", gate: { p975Ms: 300, minRps: 475 },
      opts: { duration: DURATION, connections: Number(process.env.LOAD_CONNECTIONS ?? 20), overallRate: Number(process.env.LOAD_READ_RPS ?? 500), requests: [{ setupRequest: asOwner("/v1/members") as never }] } },
    { name: "signup", what: "POST /v1/tenants at 50/s: store, owner, warehouse, events, audit", gate: { p975Ms: 300, minRps: 47 },
      opts: { duration: DURATION, connections: 20, overallRate: 50, requests: [{ setupRequest: signup as never }] } },
    { name: "health-max", what: "GET /health, unthrottled (framework baseline, not gated)", gate: null,
      opts: { duration: Math.min(DURATION, 10), connections: 100, requests: [{ method: "GET", path: "/health" }] } },
    { name: "reads-max", what: "GET /v1/members, unthrottled, 100 connections (capacity, not gated)", gate: null,
      opts: { duration: Math.min(DURATION, 15), connections: 100, requests: [{ setupRequest: asOwner("/v1/members") as never }] } },
  ];

  const results: Row[] = [];
  const only = process.env.LOAD_ONLY?.split(",");
  for (const s of scenarios.filter((x) => !only || x.name === "warm-up" || only.includes(x.name))) {
    // One generator per instance, each with its share of the rate, connections and amount.
    const share = (n: number | undefined) => (n === undefined ? undefined : Math.ceil(n / ports.length));
    const runs = await Promise.all(ports.map((port) => autocannon({
      url: `http://127.0.0.1:${port}`, ...s.opts,
      connections: share(s.opts.connections), overallRate: share(s.opts.overallRate), amount: share(s.opts.amount),
    } as autocannon.Options)));
    const worst = (k: string) => Math.max(...runs.map((r) => (r.latency as unknown as Record<string, number>)[k]!));
    const sum = (f: (r: autocannon.Result) => number) => runs.reduce((a, r) => a + f(r), 0);
    const row: Row = {
      name: s.name, what: s.what, sent: sum((r) => r.requests.total), rps: Math.round(sum((r) => r.requests.average)),
      p50: worst("p50"), p90: worst("p90"), p975: worst("p97_5"), p99: worst("p99"), max: worst("max"),
      non2xx: sum((r) => r.non2xx), errors: sum((r) => r.errors), timeouts: sum((r) => r.timeouts), pass: null, why: [],
    };
    if (s.gate) {
      if (row.p975 > s.gate.p975Ms) row.why.push(`p97.5 ${row.p975} ms > ${s.gate.p975Ms} ms`);
      if (s.gate.minRps && row.rps < s.gate.minRps) row.why.push(`${row.rps} req/s < ${s.gate.minRps}`);
      if (row.non2xx || row.errors || row.timeouts) row.why.push(`${row.non2xx} non-2xx, ${row.errors} errors, ${row.timeouts} timeouts`);
      row.pass = row.why.length === 0;
      if (!row.pass) failed = true;
    }
    results.push(row);
    console.error(`${s.name}: ${row.rps} req/s, p50 ${row.p50} ms, p97.5 ${row.p975} ms, p99 ${row.p99} ms${row.pass === false ? `  FAIL: ${row.why.join("; ")}` : ""}`);
  }

  // Every acknowledged webhook must have been recorded (dedupe row) and queued, not just answered 200.
  const sentWebhooks = results.filter((r) => r.name === "warm-up" || r.name === "webhook-burst").reduce((a, r) => a + r.sent, 0);
  const check = new pg.Client({ connectionString: dbUrl });
  await check.connect();
  const [recorded] = (await check.query<{ inbound: string; jobs: string }>(
    `SELECT (SELECT count(*) FROM mz_inbound_events)::text AS inbound, (SELECT count(*) FROM mz_outbox)::text AS jobs`)).rows;
  await check.end();
  console.error(`webhooks sent ${sentWebhooks}, recorded ${recorded!.inbound}, engine jobs queued ${recorded!.jobs}`);
  if (Number(recorded!.inbound) < sentWebhooks) {
    failed = true;
    console.error(`FAIL: ${sentWebhooks - Number(recorded!.inbound)} acknowledged webhooks were not recorded`);
  }

  const verdict = (r: Row) => (r.pass === null ? "—" : r.pass ? "✅" : `❌ ${r.why.join("; ")}`);
  console.log(["| Scenario | Load | req/s | p50 ms | p90 ms | p97.5 ms | p99 ms | Errors | Gate |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...results.map((r) => `| ${r.name} | ${r.what} | ${r.rps} | ${r.p50} | ${r.p90} | ${r.p975} | ${r.p99} | ${r.non2xx + r.errors + r.timeouts} | ${verdict(r)} |`)].join("\n"));
  if (process.env.LOAD_OUT) writeFileSync(process.env.LOAD_OUT, JSON.stringify({ at: new Date().toISOString(), instances: INSTANCES, tenants: TENANTS, durationS: DURATION, webhooks: { sent: sentWebhooks, recorded: Number(recorded!.inbound), jobs: Number(recorded!.jobs) }, results }, null, 2));
} finally {
  for (const child of servers) child.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 500));
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.end();
}
process.exit(failed ? 1 : 0);

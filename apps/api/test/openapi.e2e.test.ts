import "reflect-metadata";
import { readFileSync, writeFileSync } from "node:fs";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { registeredSchema } from "../src/platform/http/api-schema.js";
import { ProblemDetailsSchema } from "../src/platform/http/problem.js";
import { buildOpenApi } from "../src/platform/openapi.js";
import { FakeVerifier } from "./support/fake-auth.js";

/**
 * The OpenAPI contract (E4-4). apps/api/openapi.json is what the web client is generated from:
 *  - it must equal what the running API builds (UPDATE_OPENAPI=1 rewrites it: `npm run openapi -w @mizan/api`);
 *  - every operation documents its success response and request body;
 *  - real responses from a walk through the API match the documented schema for their status.
 */
// Fake credential, assembled at runtime so secret scanners do not flag the fixture.
const FAKE_KEY = ["bosta", "key", "1234"].join("-");
const SNAPSHOT = new URL("../openapi.json", import.meta.url);
type Op = { requestBody?: unknown; responses: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }> };
type Doc = { paths: Record<string, Record<string, Op>>; components: { schemas: Record<string, unknown> } };

const fake = new FakeVerifier();
let app: INestApplication;
let doc: Doc;
const http = () => request(app.getHttpServer());
const as = (token: string, tenant?: string) => ({ Authorization: `Bearer ${token}`, "Accept-Language": "en", ...(tenant ? { "X-Tenant-Id": tenant } : {}) });
const checked = new Set<string>();

/** Validate a response against the spec entry for (method, templated path, status). */
function conforms(method: string, path: string, res: request.Response): void {
  const op = doc.paths[path]?.[method];
  expect(op, `${method} ${path} is documented`).toBeDefined();
  const entry = op!.responses[String(res.status)] ?? (res.status >= 400 ? op!.responses.default : undefined);
  expect(entry, `${method.toUpperCase()} ${path} documents status ${res.status}`).toBeDefined();
  checked.add(`${method} ${path}`);
  if (res.status === 204) return;
  if (res.status >= 400) {
    expect(res.headers["content-type"]).toMatch(/^application\/problem\+json/);
    ProblemDetailsSchema.parse(res.body);
    return;
  }
  const ref = entry!.content?.["application/json"]?.schema?.$ref;
  expect(ref, `${method} ${path} ${res.status} has a schema`).toBeDefined();
  const name = ref!.split("/").at(-1)!;
  const result = registeredSchema(name)!.safeParse(res.body);
  expect(result.success, `${method.toUpperCase()} ${path} → ${name}: ${result.error?.message}`).toBe(true);
}

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "http://localhost", WEB_URL: "https://app.mizan.test" });
  app = await createApp(config, { logDestination: new Writable({ write: (_c, _e, d) => d() }), tokenVerifier: fake });
  await app.init();
  doc = buildOpenApi(app) as unknown as Doc;
  fake.add("owner", { uid: "fb-owner", email: "owner@nile.test", emailVerified: true, secondFactor: "phone" });
  fake.add("agent", { uid: "fb-agent", phone: "+201001234821" });
});
afterAll(() => app.close());

describe("openapi.json", () => {
  it("is the document the API builds (run `npm run openapi -w @mizan/api` after changing a route or schema)", () => {
    const built = `${JSON.stringify(doc, null, 2)}\n`;
    if (process.env.UPDATE_OPENAPI) writeFileSync(SNAPSHOT, built);
    expect(readFileSync(SNAPSHOT, "utf8")).toBe(built);
  });

  it("every operation has a typed success response, a problem default, and its request body", () => {
    const bodies = new Set([
      "post /v1/tenants", "post /v1/orders/{id}/payments", "post /v1/tickets", "patch /v1/tickets/{id}", "post /v1/orders/{id}/refunds", "post /v1/refunds/{refundId}/reject", "post /v1/refunds/{refundId}/complete", "put /v1/settings/refunds", "post /v1/orders/{id}/returns/inspect", "post /v1/usage/upgrade", "post /v1/members/invite", "patch /v1/members/{userId}", "post /v1/admin/integrations/cities/resolve", "post /v1/connections/shopify/claim",
      "post /v1/connections/bosta", "put /v1/products/variants/costs", "patch /v1/onboarding", "post /v1/cost-rules", "put /v1/fx-rates/{day}/{quote}",
      "post /v1/orders/{id}/confirmation", "put /v1/settings/confirmation", "post /v1/public/confirm/{token}", "post /v1/profit/recalculate", "post /v1/connections/whatsapp", "put /v1/settings/offers", "post /v1/offer-rules", "patch /v1/offer-rules/{id}", "post /v1/orders/{id}/offer", "put /v1/ad-spend", "post /v1/ad-spend/import", "post /v1/orders/{id}/duplicate", "put /v1/settings/orders", "post /v1/orders", "post /v1/orders/bulk", "patch /v1/products/variants/{id}", "post /v1/products/costs/import", "post /v1/stock/movements", "post /v1/ops/sync", "patch /v1/stock/{variantId}", "put /v1/settings/inventory", "post /v1/automations", "put /v1/automations/{id}", "patch /v1/automations/{id}", "post /v1/automations/{id}/test", "post /v1/notifications/read", "post /v1/automations/recipes/{key}/install",
    ]);
    for (const [path, item] of Object.entries(doc.paths)) {
      for (const [method, op] of Object.entries(item)) {
        const key = `${method} ${path}`;
        const ok = Object.entries(op.responses).filter(([s]) => s.startsWith("2"));
        expect(ok.length, `${key} documents a success`).toBeGreaterThan(0);
        for (const [status, r] of ok) if (status !== "204") expect(r.content?.["application/json"]?.schema?.$ref, `${key} ${status}`).toMatch(/^#\/components\/schemas\//);
        expect(op.responses.default?.content?.["application/problem+json"], `${key} default problem`).toBeDefined();
        expect(Boolean(op.requestBody), `${key} request body`).toBe(bodies.has(key));
      }
    }
  });

  it("every $ref resolves", () => {
    const refs = [...JSON.stringify(doc).matchAll(/"\$ref":"#\/components\/schemas\/(\w+)"/g)].map((m) => m[1]!);
    expect(refs.length).toBeGreaterThan(20);
    for (const r of refs) expect(doc.components.schemas[r], r).toBeDefined();
  });
});

describe("real responses match the documented schemas", () => {
  it("walks the platform routes", async () => {
    conforms("get", "/health", await http().get("/health"));
    conforms("get", "/health/ready", await http().get("/health/ready"));

    const created = await http().post("/v1/tenants").set(as("owner")).send({ name: "Nile Abayas", country: "EG" });
    conforms("post", "/v1/tenants", created);
    const store = created.body.id as string;
    conforms("post", "/v1/tenants", await http().post("/v1/tenants").set(as("owner")).send({ name: "x", country: "ZZ" })); // 400
    conforms("get", "/v1/tenant", await http().get("/v1/tenant").set(as("owner", store)));
    conforms("get", "/v1/me", await http().get("/v1/me").set(as("owner")));

    const invite = await http().post("/v1/members/invite").set(as("owner", store)).send({ phone: "01001234821", role: "agent" });
    conforms("post", "/v1/members/invite", invite);
    conforms("get", "/v1/me", await http().get("/v1/me").set(as("agent")));
    conforms("get", "/v1/tenant", await http().get("/v1/tenant").set(as("agent", store))); // 403 not_a_member
    conforms("post", "/v1/invitations/{id}/accept", await http().post(`/v1/invitations/${invite.body.id}/accept`).set(as("agent")));
    conforms("get", "/v1/members", await http().get("/v1/members").set(as("owner", store)));

    const team = await http().get("/v1/members").set(as("owner", store));
    const agentId = team.body.members.find((m: { role: string }) => m.role === "agent").userId as string;
    conforms("patch", "/v1/members/{userId}", await http().patch(`/v1/members/${agentId}`).set(as("owner", store)).send({ role: "warehouse" }));
    const second = await http().post("/v1/members/invite").set(as("owner", store)).send({ email: "ops@nile.test", role: "ops_manager" });
    conforms("delete", "/v1/invitations/{id}", await http().delete(`/v1/invitations/${second.body.id}`).set(as("owner", store)));
    conforms("delete", "/v1/members/{userId}", await http().delete(`/v1/members/${agentId}`).set(as("owner", store)));

    conforms("get", "/v1/audit-log", await http().get("/v1/audit-log?limit=5").set(as("owner", store)));
    conforms("get", "/v1/privacy-requests", await http().get("/v1/privacy-requests").set(as("owner", store)));
    conforms("get", "/v1/admin/integrations/health", await http().get("/v1/admin/integrations/health").set(as("owner", store)));
    conforms("get", "/v1/orders", await http().get("/v1/orders?status=new&limit=5").set(as("owner", store)));
    conforms("get", "/v1/orders", await http().get("/v1/orders?cursor=bad").set(as("owner", store))); // 422
    const noOrder = "00000000-0000-4000-8000-000000000000";
    conforms("get", "/v1/orders/{id}", await http().get(`/v1/orders/${noOrder}`).set(as("owner", store))); // 404
    conforms("post", "/v1/orders/{id}/reveal", await http().post(`/v1/orders/${noOrder}/reveal`).set(as("owner", store))); // 404
    conforms("get", "/v1/onboarding", await http().get("/v1/onboarding").set(as("owner", store)));
    conforms("patch", "/v1/onboarding", await http().patch("/v1/onboarding").set(as("owner", store)).send({ skip: { courier: true } }));
    conforms("get", "/v1/connections", await http().get("/v1/connections").set(as("owner", store)));
    conforms("post", "/v1/connections/bosta", await http().post("/v1/connections/bosta").set(as("owner", store)).send({ apiKey: FAKE_KEY })); // 409: no store yet
    conforms("get", "/v1/products/variants/costs", await http().get("/v1/products/variants/costs?missingCost=true").set(as("owner", store)));
    conforms("put", "/v1/products/variants/costs", await http().put("/v1/products/variants/costs").set(as("owner", store)).send({ items: [{ variantId: store, cost: "10" }] })); // 404
    const rule = await http().post("/v1/cost-rules").set(as("owner", store)).send({ kind: "courier_rate", amount: "60", scope: { courier: "bosta" } });
    conforms("post", "/v1/cost-rules", rule);
    conforms("post", "/v1/cost-rules", await http().post("/v1/cost-rules").set(as("owner", store)).send({ kind: "cod_fee_pct", pct: "500" })); // 422
    conforms("get", "/v1/cost-rules", await http().get("/v1/cost-rules?history=true").set(as("owner", store)));
    conforms("delete", "/v1/cost-rules/{id}", await http().delete(`/v1/cost-rules/${rule.body.id}`).set(as("owner", store)));
    conforms("put", "/v1/fx-rates/{day}/{quote}", await http().put("/v1/fx-rates/2026-10-20/USD").set(as("owner", store)).send({ rate: "0.0205" }));
    conforms("get", "/v1/fx-rates", await http().get("/v1/fx-rates?day=2026-10-20").set(as("owner", store)));
    conforms("get", "/v1/orders/{id}/confirmation", await http().get(`/v1/orders/${noOrder}/confirmation`).set(as("owner", store))); // 404
    conforms("post", "/v1/orders/{id}/confirmation/link", await http().post(`/v1/orders/${noOrder}/confirmation/link`).set(as("owner", store))); // 404
    conforms("post", "/v1/orders/{id}/confirmation", await http().post(`/v1/orders/${noOrder}/confirmation`).set(as("owner", store)).send({ answer: "confirm" })); // 404
    const conf = await http().get("/v1/settings/confirmation").set(as("owner", store));
    conforms("get", "/v1/settings/confirmation", conf);
    conforms("put", "/v1/settings/confirmation", await http().put("/v1/settings/confirmation").set(as("owner", store)).send(conf.body.settings));
    conforms("get", "/v1/public/confirm/{token}", await http().get("/v1/public/confirm/nope")); // 404
    conforms("post", "/v1/public/confirm/{token}", await http().post("/v1/public/confirm/nope").send({ answer: "confirm" })); // 404
    conforms("get", "/v1/orders/{id}/pnl", await http().get(`/v1/orders/${noOrder}/pnl`).set(as("owner", store))); // 404
    conforms("post", "/v1/profit/recalculate", await http().post("/v1/profit/recalculate").set(as("owner", store)).send({}));
    conforms("get", "/v1/connections/shopify/install", await http().get("/v1/connections/shopify/install?shop=nile.myshopify.com").set(as("owner", store)));

    expect(checked.size).toBeGreaterThanOrEqual(37);
  });
});

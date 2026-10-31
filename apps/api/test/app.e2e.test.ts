import "reflect-metadata";
import { Writable } from "node:stream";
import { Body, Controller, Get, Module, Post } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import { MoneySchema, type Money } from "@mizan/shared";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { Public } from "../src/platform/auth/decorators.js";
import { ProblemError } from "../src/platform/http/problem.js";
import { ZodPipe } from "../src/platform/http/zod.pipe.js";

@Public()
@Controller("test")
class ProbeController {
  @Get("boom")
  boom(): never {
    throw new Error("db password=hunter2 for customer 01001234821");
  }

  @Get("problem")
  problem(): never {
    throw new ProblemError(409, "duplicate_order", "order #1001 already exists", [{ path: "number", code: "taken" }]);
  }

  @Post("money")
  money(@Body(new ZodPipe(MoneySchema)) body: Money): Money {
    return body;
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

const lines: string[] = [];
const sink = new Writable({
  write(chunk, _enc, done) {
    lines.push(...String(chunk).split("\n").filter(Boolean));
    done();
  },
});

let app: INestApplication;
const http = () => request(app.getHttpServer());

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "http://localhost", WEB_URL: "http://localhost:3000", LOG_LEVEL: "info" });
  app = await createApp(config, { logDestination: sink, modules: [ProbeModule] });
  await app.init();
});
afterAll(() => app.close());
beforeEach(() => { lines.length = 0; });

describe("platform routes", () => {
  it("GET /health is unprefixed and healthy", async () => {
    const res = await http().get("/health").expect(200);
    expect(res.body).toMatchObject({ status: "ok", version: "0.1.0" });
    expect(res.headers["x-request-id"]).toMatch(/^req_[a-f0-9]{32}$/);
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("GET /v1/openapi.json describes the API", async () => {
    const res = await http().get("/v1/openapi.json").expect(200);
    expect(res.body.openapi).toMatch(/^3\.1\./);
    expect(res.body.info.title).toBe("Mizan API");
    expect(res.body.paths["/health"]).toBeDefined();
    expect(res.body.paths["/v1/test/problem"]).toBeDefined();
    expect(res.body.components.schemas.Money).toMatchObject({ type: "object", required: ["amount", "currency"] });
    expect(res.body.components.schemas.ProblemDetails).toBeDefined();
  });

  it("keeps a caller-supplied request id", async () => {
    const res = await http().get("/health").set("X-Request-Id", "trace-123").expect(200);
    expect(res.headers["x-request-id"]).toBe("trace-123");
  });
});

describe("problem+json", () => {
  it("unknown route → 404, Arabic title by default, no query echoed", async () => {
    const res = await http().get("/v1/nope?phone=01001234821").expect(404);
    expect(res.headers["content-type"]).toMatch(/^application\/problem\+json/);
    expect(res.body).toMatchObject({
      type: "https://docs.mizan.app/errors/not_found", title: "مش موجود", status: 404, code: "not_found",
    });
    expect(res.body.requestId).toBe(res.headers["x-request-id"]);
    expect(JSON.stringify(res.body)).not.toContain("01001234821");
  });

  it("ProblemError keeps its status, code, detail and errors; English on request", async () => {
    const res = await http().get("/v1/test/problem").set("Accept-Language", "en").expect(409);
    expect(res.body).toMatchObject({
      code: "duplicate_order", title: "Conflict", detail: "order #1001 already exists", errors: [{ path: "number", code: "taken" }],
    });
  });

  it("zod validation → 422 validation_failed with paths", async () => {
    const res = await http().post("/v1/test/money").send({ amount: 1150, currency: "egp" }).expect(422);
    expect(res.body.code).toBe("validation_failed");
    expect(res.body.errors.map((e: { path: string }) => e.path).sort()).toEqual(["amount", "currency"]);
    await http().post("/v1/test/money").send({ amount: "1150.00", currency: "EGP" }).expect(201);
  });

  it("unexpected error → generic 500; details logged redacted, never returned", async () => {
    const res = await http().get("/v1/test/boom").set("Accept-Language", "en").expect(500);
    expect(res.body).toEqual({
      type: "https://docs.mizan.app/errors/internal_error", title: "Something went wrong", status: 500,
      code: "internal_error", requestId: res.headers["x-request-id"],
    });
    const log = lines.join("\n");
    expect(log).toContain("unhandled error");
    expect(log).toContain("010•••4821");
    expect(log).not.toContain("01001234821");
  });
});

describe("logging", () => {
  it("request logs carry no raw phone, email or token", async () => {
    await http()
      .get("/v1/nope?phone=%2B201001234821&email=sara%40example.com")
      .set("Authorization", "Bearer secret-token-value")
      .set("Cookie", "session=abc");
    const log = lines.join("\n");
    expect(lines.length).toBeGreaterThan(0);
    expect(log).not.toContain("1001234821");
    expect(log).not.toMatch(/sara(%40|@)example/);
    expect(log).not.toContain("secret-token-value");
    expect(log).not.toContain("session=abc");
    const entry = JSON.parse(lines.find((l) => l.includes("request completed"))!);
    expect(entry).toMatchObject({ severity: "WARN", req: { method: "GET" }, res: { statusCode: 404 } });
  });
});

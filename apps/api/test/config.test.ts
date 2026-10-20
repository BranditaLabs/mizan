import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/platform/config.js";

const valid = { PUBLIC_URL: "https://api.mizan.test", WEB_URL: "https://app.mizan.test" };

describe("loadConfig", () => {
  it("parses a minimal environment and applies defaults", () => {
    expect(loadConfig(valid)).toMatchObject({
      NODE_ENV: "development", PORT: 8080, LOG_LEVEL: "info", SHOPIFY_API_VERSION: "2026-10", ...valid,
    });
  });

  it("coerces PORT and treats empty strings as unset", () => {
    expect(loadConfig({ ...valid, PORT: "3001", LOG_LEVEL: "" })).toMatchObject({ PORT: 3001, LOG_LEVEL: "info" });
  });

  it("lists every problem at once", () => {
    let err: unknown;
    try {
      loadConfig({ PORT: "abc", LOG_LEVEL: "loud", WEB_URL: "ftp://x", SHOPIFY_API_VERSION: "latest" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConfigError);
    const problems = (err as ConfigError).problems.join("\n");
    expect(problems).toContain("PORT: must be a number");
    expect(problems).toContain("LOG_LEVEL: must be one of");
    expect(problems).toContain("PUBLIC_URL: is required");
    expect(problems).toContain("WEB_URL: must be an http(s) URL");
    expect(problems).toContain("SHOPIFY_API_VERSION: must look like 2026-10");
  });

  it("requires DATABASE_URL in production", () => {
    expect(() => loadConfig({ ...valid, NODE_ENV: "production" })).toThrow(/DATABASE_URL: a postgres:\/\/ URL is required in production/);
    expect(() => loadConfig({ ...valid, NODE_ENV: "production", DATABASE_URL: "pglite:./data" })).toThrow(/required in production/);
    expect(() => loadConfig({ ...valid, DATABASE_URL: "mysql://x" })).toThrow(/DATABASE_URL: must be a postgres:\/\/ URL or pglite:<dir>/);
    expect(() => loadConfig({ ...valid, NODE_ENV: "production", DATABASE_URL: "postgres://db/mizan" })).toThrow(/FIREBASE_PROJECT_ID: is required in production/);
    const prod = { ...valid, NODE_ENV: "production", DATABASE_URL: "postgres://db/mizan", FIREBASE_PROJECT_ID: "mizan-prod" };
    expect(() => loadConfig(prod)).toThrow(/KMS_KEY_NAME: is required in production/);
    const kms = "projects/mizan-prod/locations/me-central1/keyRings/mizan/cryptoKeys/tenant-data";
    expect(loadConfig({ ...prod, KMS_KEY_NAME: kms }).NODE_ENV).toBe("production");
    const devKey = Buffer.alloc(32, 7).toString("base64");
    expect(() => loadConfig({ ...prod, KMS_KEY_NAME: kms, SECRETS_DEV_KEY: devKey })).toThrow(/SECRETS_DEV_KEY: must not be set in production/);
    expect(loadConfig({ ...valid, SECRETS_DEV_KEY: devKey }).SECRETS_DEV_KEY).toBe(devKey);
    expect(() => loadConfig({ ...valid, SECRETS_DEV_KEY: "c2hvcnQ=" })).toThrow(/SECRETS_DEV_KEY: must be base64 of exactly 32 bytes/);
    expect(loadConfig({ ...valid, AUTH_REQUIRE_MFA: "false" }).AUTH_REQUIRE_MFA).toBe(false);
    expect(() => loadConfig({ ...valid, AUTH_REQUIRE_MFA: "maybe" })).toThrow(/AUTH_REQUIRE_MFA/);
  });

  it("never echoes a value, so secrets cannot leak into logs", () => {
    const secret = "shpss_THIS_MUST_NOT_APPEAR";
    try {
      loadConfig({ ...valid, PORT: secret, PUBLIC_URL: secret, SHOPIFY_API_VERSION: secret });
      expect.unreachable();
    } catch (e) {
      expect(String((e as Error).message)).not.toContain("THIS_MUST_NOT_APPEAR");
    }
  });
});

const main = fileURLToPath(new URL("../dist/main.js", import.meta.url));

describe.skipIf(!existsSync(main))("process start (built)", () => {
  it("the API serves, then exits 0 on SIGTERM with its last logs flushed", async () => {
    const { spawn } = await import("node:child_process");
    const child = spawn(process.execPath, [main], {
      env: { PATH: process.env.PATH, NODE_ENV: "test", PORT: "18931", PUBLIC_URL: "http://localhost", WEB_URL: "http://localhost:3000" },
    });
    let out = "";
    child.stdout.on("data", (d) => { out += String(d); });
    let up = false;
    for (let i = 0; i < 150 && !up; i++) {
      up = await fetch("http://127.0.0.1:18931/health").then((r) => r.ok, () => false);
      if (!up) await new Promise((r) => setTimeout(r, 100));
    }
    expect(up).toBe(true);
    child.kill("SIGTERM");
    const code = await new Promise<number | null>((resolve) => child.on("exit", resolve));
    expect(code).toBe(0);
    expect(out).toContain("SIGTERM received, shutting down");
  });

  it("the worker starts, dispatches, and stops cleanly on SIGTERM", async () => {
    const { spawn } = await import("node:child_process");
    const worker = fileURLToPath(new URL("../dist/worker.js", import.meta.url));
    const child = spawn(process.execPath, [worker], {
      env: { PATH: process.env.PATH, NODE_ENV: "test", PUBLIC_URL: "http://localhost", WEB_URL: "http://localhost:3000" },
    });
    let out = "";
    child.stdout.on("data", (d) => { out += String(d); });
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`worker did not start: ${out}`)), 15_000);
      child.stdout.on("data", () => { if (out.includes("dispatching domain events")) { clearTimeout(t); resolve(); } });
    });
    child.kill("SIGTERM");
    // Shutdown hooks run (dispatcher stops, DB closes), logs flush, exit code 0.
    const code = await new Promise<number | null>((resolve) => child.on("exit", resolve));
    expect(code).toBe(0);
    expect(out).toContain("SIGTERM received, shutting down");
    expect(out).toContain("event dispatcher stopped");
  });

  it("exits 1 with a readable message on an invalid environment", () => {
    const run = spawnSync(process.execPath, [main], { env: { PATH: process.env.PATH, PORT: "abc" }, encoding: "utf8", timeout: 15_000 });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("Invalid environment configuration");
    expect(run.stderr).toContain("PORT: must be a number");
    expect(run.stderr).toContain("PUBLIC_URL: is required");
  });
});

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
    expect(loadConfig({ ...valid, NODE_ENV: "production", DATABASE_URL: "postgres://db/mizan", FIREBASE_PROJECT_ID: "mizan-prod" }).NODE_ENV).toBe("production");
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
  it("exits 1 with a readable message on an invalid environment", () => {
    const run = spawnSync(process.execPath, [main], { env: { PATH: process.env.PATH, PORT: "abc" }, encoding: "utf8", timeout: 15_000 });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("Invalid environment configuration");
    expect(run.stderr).toContain("PORT: must be a number");
    expect(run.stderr).toContain("PUBLIC_URL: is required");
  });
});

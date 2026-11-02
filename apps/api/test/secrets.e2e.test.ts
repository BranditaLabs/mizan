import "reflect-metadata";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import { inspect } from "node:util";
import { Logger, type INestApplication } from "@nestjs/common";
import { sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/platform/config.js";
import { Database } from "../src/platform/db/database.js";
import { LocalKeyWrapper, type KeyWrapper } from "../src/platform/secrets/key-wrapper.js";
import { KeyVaultKeyWrapper } from "../src/platform/secrets/keyvault-wrapper.js";
import { SecretValue } from "../src/platform/secrets/secret-value.js";
import { keyWrapperFor } from "../src/platform/secrets/secrets.module.js";
import { SecretsService } from "../src/platform/secrets/secrets.service.js";

// A fake Shopify token, assembled at runtime so secret scanners do not flag the fixture.
const TOKEN = ["shpat", "9f8e7d6c5b4a39281706f5e4d3c2b1a0"].join("_");
const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const by = { actor: { type: "user" as const, id: "00000000-0000-4000-8000-0000000000aa" }, ip: "197.34.12.9" };

/** A wrapper whose key can be swapped, to simulate KMS key rotation. */
class RotatingWrapper implements KeyWrapper {
  readonly keys = new Map<string, LocalKeyWrapper>([["v1", new LocalKeyWrapper(randomBytes(32), "v1")]]);
  current = "v1";
  rotate(to: string) { this.keys.set(to, new LocalKeyWrapper(randomBytes(32), to)); this.current = to; }
  wrap(k: Buffer) { return this.keys.get(this.current)!.wrap(k); }
  unwrap(w: Buffer, v: string) { return this.keys.get(v)!.unwrap(w, v); }
  async currentVersion() { return this.current; }
}

const logs: string[] = [];
const wrapper = new RotatingWrapper();
let app: INestApplication;
let db: Database;
let secrets: SecretsService;

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_URL: "http://localhost", WEB_URL: "http://localhost:3000", LOG_LEVEL: "debug" });
  const sink = new Writable({ write(c, _e, d) { logs.push(String(c)); d(); } });
  app = await createApp(config, { logDestination: sink, keyWrapper: wrapper });
  await app.init();
  db = app.get(Database);
  secrets = app.get(SecretsService);
  await db.kysely.insertInto("tenants").values([{ id: A, name: "A", slug: "a" }, { id: B, name: "B", slug: "b" }]).execute();
});
afterAll(() => app.close());
beforeEach(() => { logs.length = 0; });

const create = (tenant: string, value = TOKEN) => db.tenant(tenant, (trx) => secrets.create(trx, tenant, value, by));
const read = (tenant: string, id: string) => db.tenant(tenant, (trx) => secrets.read(trx, tenant, id));
const rawRows = () => sql<Record<string, unknown>>`SELECT * FROM secrets`.execute(db.kysely).then((r) => r.rows);

describe("SecretsService", () => {
  it("stores no plaintext in the database and logs none, even when the value is logged", async () => {
    const id = await create(A);
    const value = await read(A, id);
    expect(value.reveal()).toBe(TOKEN);

    // Someone logs it by mistake, in every way they might:
    const log = new Logger("Careless");
    log.log(`connected with ${value}`);
    log.log({ token: value, nested: { value } });
    log.error(new Error(`provider rejected ${value}`));

    const row = (await rawRows()).find((r) => r.id === id)!;
    const dump = JSON.stringify(row, (_k, v) => (v && v.type === "Buffer" ? Buffer.from(v.data).toString("latin1") : v));
    expect(dump).not.toContain(TOKEN);
    expect(dump).not.toContain(Buffer.from(TOKEN).toString("base64"));
    expect(Buffer.isBuffer(row.ciphertext) || row.ciphertext instanceof Uint8Array).toBe(true);
    expect(row.key_version).toBe("v1");

    const all = logs.join("");
    expect(all).toContain("connected with [secret]");
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain("9f8e7d6c5b4a");
  });

  it("SecretValue never prints", () => {
    const v = new SecretValue(TOKEN);
    expect(String(v)).toBe("[secret]");
    expect(`${v}`).toBe("[secret]");
    expect(JSON.stringify({ v })).toBe('{"v":"[secret]"}');
    expect(inspect({ v })).not.toContain(TOKEN);
  });

  it("a ciphertext only opens in its own row and tenant", async () => {
    const a = await create(A);
    const b = await create(B, "bosta-live-key-777");
    // An attacker with write access moves A's ciphertext and wrapped key into B's row:
    await sql`UPDATE secrets SET ciphertext = src.ciphertext, wrapped_key = src.wrapped_key
              FROM (SELECT ciphertext, wrapped_key FROM secrets WHERE id = ${a}) src WHERE secrets.id = ${b}`.execute(db.kysely);
    await expect(read(B, b)).rejects.toThrow(/unable to authenticate|auth/i);
  });

  it("detects tampering", async () => {
    const id = await create(A);
    await sql`UPDATE secrets SET ciphertext = set_byte(ciphertext, 30, (get_byte(ciphertext, 30) + 1) % 256) WHERE id = ${id}`.execute(db.kysely);
    await expect(read(A, id)).rejects.toThrow();
  });

  it("is invisible to other tenants", async () => {
    const id = await create(A);
    await expect(read(B, id)).rejects.toMatchObject({ status: 404, code: "secret_not_found" });
  });

  it("rotates the value with a new data key, and deletes", async () => {
    const id = await create(A);
    const [before] = (await rawRows()).filter((r) => r.id === id);
    await db.tenant(A, (trx) => secrets.rotate(trx, A, id, "shpat_rotated_value_0001", by));
    const [after] = (await rawRows()).filter((r) => r.id === id);
    expect(Buffer.compare(before!.wrapped_key as Buffer, after!.wrapped_key as Buffer)).not.toBe(0);
    expect(after!.rotated_at).toBeInstanceOf(Date);
    expect((await read(A, id)).reveal()).toBe("shpat_rotated_value_0001");

    await db.tenant(A, (trx) => secrets.delete(trx, A, id, by));
    await expect(read(A, id)).rejects.toMatchObject({ code: "secret_not_found" });
    await expect(db.tenant(A, (trx) => secrets.rotate(trx, A, id, "x", by))).rejects.toMatchObject({ code: "secret_not_found" });

    const audit = await db.tenant(A, (trx) => trx.selectFrom("audit_log").select(["action", "entity_id", "ip"]).where("entity_id", "=", id).orderBy("id").execute());
    expect(audit).toEqual([
      { action: "secret.created", entity_id: id, ip: "197.34.12.9" },
      { action: "secret.rotated", entity_id: id, ip: "197.34.12.9" },
      { action: "secret.deleted", entity_id: id, ip: "197.34.12.9" },
    ]);
  });

  it("rejects empty values", async () => {
    await expect(create(A, "")).rejects.toMatchObject({ status: 422 });
  });

  it("re-wraps data keys after a KMS key rotation without touching values", async () => {
    const ids = [await create(A, "value-one"), await create(A, "value-two")];
    wrapper.rotate("v2");
    const done = await db.tenant(A, (trx) => secrets.rewrapStale(trx));
    expect(done).toBeGreaterThanOrEqual(2);
    const versions = await db.tenant(A, (trx) => trx.selectFrom("secrets").select("key_version").distinct().execute());
    expect(versions).toEqual([{ key_version: "v2" }]);
    expect((await read(A, ids[0]!)).reveal()).toBe("value-one");
    expect((await read(A, ids[1]!)).reveal()).toBe("value-two");
    expect(await db.tenant(A, (trx) => secrets.rewrapStale(trx))).toBe(0);
  });
});

describe("LocalKeyWrapper", () => {
  it("round-trips and refuses other versions and bad keys", async () => {
    const w = new LocalKeyWrapper(randomBytes(32), "local-v1");
    const dk = randomBytes(32);
    const { wrapped, keyVersion } = await w.wrap(dk);
    expect(await w.unwrap(wrapped, keyVersion)).toEqual(dk);
    await expect(w.unwrap(wrapped, "local-v2")).rejects.toThrow(/no local key/);
    await expect(new LocalKeyWrapper(randomBytes(32)).unwrap(wrapped, keyVersion)).rejects.toThrow();
    expect(() => new LocalKeyWrapper(randomBytes(16))).toThrow(/32 bytes/);
  });
});

describe("KeyVaultKeyWrapper (fake Key Vault)", () => {
  const KEY = "https://mizan-test-kv.vault.azure.net/keys/tenant-secrets";
  const V1 = `${KEY}/${"a".repeat(32)}`;
  const V2 = `${KEY}/${"b".repeat(32)}`;
  const identity = { endpoint: "http://localhost:42356/msi/token", header: "id-header", clientId: "client-1" };

  // RSA-OAEP stands in as AES-GCM per version: what matters is the REST shape and the version each wrap carries.
  function fakeVault(opts: { failFirst?: number; status?: number } = {}) {
    const keks = new Map([[V1, randomBytes(32)], [V2, randomBytes(32)]]);
    let current = V1;
    const calls: string[] = [];
    let fail = opts.failFirst ?? 0;
    const http = (async (url: string | URL, init?: RequestInit) => {
      const u = new URL(String(url));
      const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (u.host === "localhost:42356") {
        calls.push(`token ${u.searchParams.get("resource")} ${u.searchParams.get("client_id")}`);
        if (headers["X-IDENTITY-HEADER"] !== "id-header") return json(401, {});
        return json(200, { access_token: "kv.token", expires_on: String(Math.floor(Date.now() / 1000) + 3600) });
      }
      calls.push(`${init?.method ?? "GET"} ${u.pathname}`);
      if (u.searchParams.get("api-version") !== "7.4") return json(400, {});
      if (headers.Authorization !== "Bearer kv.token") return json(401, {});
      if (fail-- > 0) return json(opts.status ?? 503, { error: { message: "echo of input would go here" } });
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const kid = `https://${u.host}${u.pathname.replace(/\/(wrapkey|unwrapkey)$/, "")}`;
      if (u.pathname.endsWith("/wrapkey")) {
        expect(body.alg).toBe("RSA-OAEP-256");
        const iv = randomBytes(12);
        const c = createCipheriv("aes-256-gcm", keks.get(kid)!, iv);
        const ct = Buffer.concat([c.update(Buffer.from(body.value, "base64url")), c.final()]);
        return json(200, { kid, value: Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64url") });
      }
      if (u.pathname.endsWith("/unwrapkey")) {
        const raw = Buffer.from(body.value, "base64url");
        const d = createDecipheriv("aes-256-gcm", keks.get(kid)!, raw.subarray(0, 12));
        d.setAuthTag(raw.subarray(12, 28));
        return json(200, { kid, value: Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("base64url") });
      }
      return json(200, { key: { kid: current } });
    }) as typeof fetch;
    return { http, calls, rotate: () => { current = V2; } };
  }

  it("wraps with the current version, unwraps with the version that wrapped, caching the token", async () => {
    let now = Date.now();
    const vault = fakeVault();
    const kv = new KeyVaultKeyWrapper(KEY, identity, vault.http, () => now);
    const dk = randomBytes(32);
    const { wrapped, keyVersion } = await kv.wrap(dk);
    expect(keyVersion).toBe(V1);
    expect(await kv.unwrap(wrapped, keyVersion)).toEqual(dk);
    expect(vault.calls.filter((c) => c.startsWith("token"))).toEqual(["token https://vault.azure.net client-1"]);

    vault.rotate();
    now += 301_000; // the current version is re-read every 5 minutes
    expect(await kv.currentVersion()).toBe(V2);
    const again = await kv.wrap(dk);
    expect(again.keyVersion).toBe(V2);
    expect(await kv.unwrap(wrapped, V1)).toEqual(dk); // older secrets still open until rewrapStale()
  });

  it("never calls anything but the configured key with a version from the database", async () => {
    const kv = new KeyVaultKeyWrapper(KEY, identity, fakeVault().http);
    await expect(kv.unwrap(randomBytes(40), "https://evil.example/keys/x/" + "a".repeat(32))).rejects.toThrow(/not a version of the configured/);
    await expect(kv.unwrap(randomBytes(40), `${KEY}-other/${"a".repeat(32)}`)).rejects.toThrow(/not a version of the configured/);
    await expect(kv.unwrap(randomBytes(40), `${KEY}/../x`)).rejects.toThrow(/not a version of the configured/);
  });

  it("retries once on 503, then fails without echoing the response", async () => {
    const ok = new KeyVaultKeyWrapper(KEY, identity, fakeVault({ failFirst: 1 }).http);
    await expect(ok.wrap(randomBytes(32))).resolves.toBeDefined();
    const down = new KeyVaultKeyWrapper(KEY, identity, fakeVault({ failFirst: 5 }).http);
    const err = await down.wrap(randomBytes(32)).catch((e: Error) => e);
    expect((err as Error).message).toBe("Key Vault GET key failed: 503");
    const denied = new KeyVaultKeyWrapper(KEY, identity, fakeVault({ failFirst: 1, status: 403 }).http);
    await expect(denied.wrap(randomBytes(32))).rejects.toThrow("failed: 403");
    await expect(new KeyVaultKeyWrapper(KEY, null, fakeVault().http).wrap(randomBytes(32))).rejects.toThrow(/no managed identity/);
  });

  it("validates the key id", () => {
    expect(() => new KeyVaultKeyWrapper("tenant-secrets", identity)).toThrow(/KEY_VAULT_KEY_ID must look like/);
    expect(() => new KeyVaultKeyWrapper(`${KEY}/${"a".repeat(32)}`, identity)).toThrow(/no version/);
  });

  it("is chosen when KEY_VAULT_KEY_ID is set; local or ephemeral otherwise", () => {
    const base = loadConfig({ PUBLIC_URL: "http://x", WEB_URL: "http://y" });
    expect(keyWrapperFor({ ...base, KEY_VAULT_KEY_ID: KEY }, undefined, { IDENTITY_ENDPOINT: identity.endpoint, IDENTITY_HEADER: "h" })).toBeInstanceOf(KeyVaultKeyWrapper);
    expect(keyWrapperFor({ ...base, SECRETS_DEV_KEY: Buffer.alloc(32, 1).toString("base64") })).toBeInstanceOf(LocalKeyWrapper);
    expect(keyWrapperFor(base, { warn: () => {} } as unknown as Logger)).toBeInstanceOf(LocalKeyWrapper);
  });
});

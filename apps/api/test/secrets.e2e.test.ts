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
import { CloudKmsKeyWrapper } from "../src/platform/secrets/kms-wrapper.js";
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

describe("CloudKmsKeyWrapper (fake KMS)", () => {
  const KEY = "projects/mizan/locations/me-central1/keyRings/mizan/cryptoKeys/tenant-data";

  function fakeKms(opts: { failFirst?: number; status?: number } = {}) {
    const kek = randomBytes(32);
    const calls: string[] = [];
    let fail = opts.failFirst ?? 0;
    const http = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      calls.push(`${init?.method ?? "GET"} ${u.replace("https://cloudkms.googleapis.com/v1/", "")}`);
      const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
      if (u.startsWith("http://metadata.google.internal")) return json(200, { access_token: "ya29.token", expires_in: 3600 });
      if ((init?.headers as Record<string, string>).Authorization !== "Bearer ya29.token") return json(401, {});
      if (fail-- > 0) return json(opts.status ?? 503, { error: { message: "echo of input would go here" } });
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (u.endsWith(":encrypt")) {
        const iv = randomBytes(12);
        const c = createCipheriv("aes-256-gcm", kek, iv);
        const ct = Buffer.concat([c.update(Buffer.from(body.plaintext, "base64")), c.final()]);
        return json(200, { name: `${KEY}/cryptoKeyVersions/3`, ciphertext: Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64") });
      }
      if (u.endsWith(":decrypt")) {
        const raw = Buffer.from(body.ciphertext, "base64");
        const d = createDecipheriv("aes-256-gcm", kek, raw.subarray(0, 12));
        d.setAuthTag(raw.subarray(12, 28));
        return json(200, { plaintext: Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("base64") });
      }
      return json(200, { primary: { name: `${KEY}/cryptoKeyVersions/3` } });
    }) as typeof fetch;
    return { http, calls };
  }

  it("wraps and unwraps through KMS, caching the access token", async () => {
    const { http, calls } = fakeKms();
    const kms = new CloudKmsKeyWrapper(KEY, http);
    const dk = randomBytes(32);
    const { wrapped, keyVersion } = await kms.wrap(dk);
    expect(keyVersion).toBe(`${KEY}/cryptoKeyVersions/3`);
    expect(await kms.unwrap(wrapped)).toEqual(dk);
    expect(await kms.currentVersion()).toBe(keyVersion);
    await kms.currentVersion();
    expect(calls.filter((c) => c.includes("metadata")).length).toBe(1);
    expect(calls.filter((c) => c.startsWith("GET projects")).length).toBe(1);
  });

  it("retries once on 503, then fails without echoing the response", async () => {
    const ok = new CloudKmsKeyWrapper(KEY, fakeKms({ failFirst: 1 }).http);
    await expect(ok.wrap(randomBytes(32))).resolves.toBeDefined();
    const down = new CloudKmsKeyWrapper(KEY, fakeKms({ failFirst: 5 }).http);
    const err = await down.wrap(randomBytes(32)).catch((e: Error) => e);
    expect((err as Error).message).toBe("Cloud KMS POST encrypt failed: 503");
    const denied = new CloudKmsKeyWrapper(KEY, fakeKms({ failFirst: 1, status: 403 }).http);
    await expect(denied.wrap(randomBytes(32))).rejects.toThrow("failed: 403");
  });

  it("validates the key name", () => {
    expect(() => new CloudKmsKeyWrapper("tenant-data")).toThrow(/KMS_KEY_NAME must look like/);
  });

  it("is chosen when KMS_KEY_NAME is set; local or ephemeral otherwise", () => {
    const base = loadConfig({ PUBLIC_URL: "http://x", WEB_URL: "http://y" });
    expect(keyWrapperFor({ ...base, KMS_KEY_NAME: KEY })).toBeInstanceOf(CloudKmsKeyWrapper);
    expect(keyWrapperFor({ ...base, SECRETS_DEV_KEY: Buffer.alloc(32, 1).toString("base64") })).toBeInstanceOf(LocalKeyWrapper);
    expect(keyWrapperFor(base, { warn: () => {} } as unknown as Logger)).toBeInstanceOf(LocalKeyWrapper);
  });
});

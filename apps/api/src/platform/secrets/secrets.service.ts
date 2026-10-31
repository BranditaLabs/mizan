import { randomBytes, randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";
import type { DB } from "@mizan/db";
import { AuditService, type AuditEntry } from "../audit/audit.service.js";
import { ProblemError } from "../http/problem.js";
import { KEY_WRAPPER, open, seal, type KeyWrapper } from "./key-wrapper.js";
import { SecretValue } from "./secret-value.js";

/** Additional authenticated data: a ciphertext only opens in its own row and tenant. */
const aad = (tenantId: string, secretId: string) => Buffer.from(`mizan-secret:${tenantId}:${secretId}`);

type Actor = Pick<AuditEntry, "actor" | "ip">;

/**
 * Provider credentials (Shopify tokens, Bosta keys, Meta tokens) with envelope encryption:
 * a fresh 256-bit data key per secret seals the value (AES-256-GCM, AAD = tenant + secret id);
 * the data key is wrapped by the KeyWrapper (Cloud KMS in production) and stored beside it.
 * Plaintext exists only in memory, as a SecretValue that will not print.
 * Every method takes the caller's tenant transaction (RLS on `secrets`).
 */
@Injectable()
export class SecretsService {
  constructor(
    @Inject(KEY_WRAPPER) private readonly keys: KeyWrapper,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Store a secret; returns its id (put it in connections.secret_ref). */
  async create(trx: Transaction<DB>, tenantId: string, value: string, by: Actor): Promise<string> {
    const id = randomUUID();
    const sealed = await this.sealValue(tenantId, id, value);
    await trx.insertInto("secrets").values({ id, tenant_id: tenantId, ...sealed }).execute();
    await this.audit.record(trx, { action: "secret.created", tenantId, entity: { type: "secret", id }, ...by });
    return id;
  }

  async read(trx: Transaction<DB>, tenantId: string, id: string): Promise<SecretValue> {
    const row = await trx.selectFrom("secrets").select(["ciphertext", "wrapped_key", "key_version"]).where("id", "=", id).executeTakeFirst();
    if (!row) throw new ProblemError(404, "secret_not_found", "no such secret");
    const dataKey = await this.keys.unwrap(row.wrapped_key, row.key_version);
    try {
      return new SecretValue(open(dataKey, row.ciphertext, aad(tenantId, id)).toString("utf8"));
    } finally {
      dataKey.fill(0);
    }
  }

  /** Replace the value (provider rotated it, or on reconnect) with a new data key. */
  async rotate(trx: Transaction<DB>, tenantId: string, id: string, value: string, by: Actor): Promise<void> {
    const sealed = await this.sealValue(tenantId, id, value);
    const r = await trx.updateTable("secrets").set({ ...sealed, rotated_at: new Date() }).where("id", "=", id).executeTakeFirst();
    if (r.numUpdatedRows === 0n) throw new ProblemError(404, "secret_not_found", "no such secret");
    await this.audit.record(trx, { action: "secret.rotated", tenantId, entity: { type: "secret", id }, ...by });
  }

  async delete(trx: Transaction<DB>, tenantId: string, id: string, by: Actor): Promise<void> {
    const r = await trx.deleteFrom("secrets").where("id", "=", id).executeTakeFirst();
    if (r.numDeletedRows === 0n) return;
    await this.audit.record(trx, { action: "secret.deleted", tenantId, entity: { type: "secret", id }, ...by });
  }

  /**
   * After the KMS key is rotated: re-wrap data keys still wrapped by an older key version.
   * Values are not decrypted; only the small wrapped key changes. Returns how many were re-wrapped.
   */
  async rewrapStale(trx: Transaction<DB>, limit = 100): Promise<number> {
    const current = await this.keys.currentVersion();
    const stale = await trx.selectFrom("secrets").select(["id", "wrapped_key", "key_version"])
      .where("key_version", "!=", current).limit(limit).forUpdate().skipLocked().execute();
    for (const s of stale) {
      const dataKey = await this.keys.unwrap(s.wrapped_key, s.key_version);
      try {
        const { wrapped, keyVersion } = await this.keys.wrap(dataKey);
        await trx.updateTable("secrets").set({ wrapped_key: wrapped, key_version: keyVersion }).where("id", "=", s.id).execute();
      } finally {
        dataKey.fill(0);
      }
    }
    return stale.length;
  }

  /**
   * Seal a value that belongs to no tenant yet (a pending Shopify install), with the same
   * envelope encryption. `label` is the AAD: the blob only opens under the same label.
   */
  async sealDetached(label: string, value: string): Promise<{ ciphertext: Buffer; wrapped_key: Buffer; key_version: string }> {
    return this.sealWith(Buffer.from(`mizan-detached:${label}`), value);
  }

  async openDetached(label: string, row: { ciphertext: Buffer; wrapped_key: Buffer; key_version: string }): Promise<SecretValue> {
    const dataKey = await this.keys.unwrap(row.wrapped_key, row.key_version);
    try {
      return new SecretValue(open(dataKey, row.ciphertext, Buffer.from(`mizan-detached:${label}`)).toString("utf8"));
    } finally {
      dataKey.fill(0);
    }
  }

  private async sealValue(tenantId: string, id: string, value: string) {
    return this.sealWith(aad(tenantId, id), value);
  }

  private async sealWith(additional: Buffer, value: string) {
    if (!value) throw new ProblemError(422, "validation_failed", "secret value is empty");
    const dataKey = randomBytes(32);
    try {
      const ciphertext = seal(dataKey, Buffer.from(value, "utf8"), additional);
      const { wrapped, keyVersion } = await this.keys.wrap(dataKey);
      return { ciphertext, wrapped_key: wrapped, key_version: keyVersion };
    } finally {
      dataKey.fill(0);
    }
  }
}

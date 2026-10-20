import { createHmac, hkdfSync, randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";
import type { DB } from "@mizan/db";
import { open, seal } from "../secrets/key-wrapper.js";
import { SecretsService } from "../secrets/secrets.service.js";

/** Columns holding personal data; the name is part of each value's AAD. */
export type PiiColumn =
  | "customers.name" | "customers.phone_e164" | "customers.email"
  | "orders.ship_name" | "orders.ship_phone" | "orders.ship_line1" | "orders.ship_line2"
  | "privacy_requests.result";

const PREFIX = "pii:v1:";

/** Per-tenant handle: encrypt/decrypt personal data and hash phones for lookups. */
export interface TenantPii {
  encrypt(value: string, column: PiiColumn): string;
  encrypt(value: string | null | undefined, column: PiiColumn): string | null;
  decrypt(stored: string | null, column: PiiColumn): string | null;
  /** HMAC-SHA256 of an E.164 phone with the tenant's pepper: stable per tenant, useless across tenants. */
  phoneHash(e164: string): string;
}

interface Keys {
  enc: Buffer;
  pepper: Buffer;
}

/**
 * Application-level encryption of personal data (CLAUDE.md rule 12, docs/07 §2).
 *
 * Each tenant has one random 256-bit key, stored through SecretsService (so it is
 * wrapped by Cloud KMS) and referenced from tenants.settings.piiKeyRef. HKDF
 * derives two keys from it: AES-256-GCM for values ("pii:v1:" + iv|tag|ct, AAD =
 * tenant + column) and an HMAC pepper for phone lookups. Deleting the tenant key
 * crypto-shreds every encrypted value (shop/redact).
 */
@Injectable()
export class PiiCipher {
  private readonly cache = new Map<string, Keys>();

  constructor(@Inject(SecretsService) private readonly secrets: SecretsService) {}

  /** Keys for a tenant, created on first use. `trx` must be the tenant's transaction. */
  async forTenant(trx: Transaction<DB>, tenantId: string): Promise<TenantPii> {
    const keys = this.cache.get(tenantId) ?? (await this.load(trx, tenantId));
    this.cache.set(tenantId, keys);
    const aad = (column: PiiColumn) => Buffer.from(`${tenantId}:${column}`);
    const encrypt = ((value: string | null | undefined, column: PiiColumn) =>
      value === null || value === undefined || value === ""
        ? null
        : PREFIX + seal(keys.enc, Buffer.from(value, "utf8"), aad(column)).toString("base64url")) as TenantPii["encrypt"];
    return {
      encrypt,
      decrypt: (stored, column) => {
        if (stored === null) return null;
        if (!stored.startsWith(PREFIX)) throw new Error(`${column} is not an encrypted value`);
        return open(keys.enc, Buffer.from(stored.slice(PREFIX.length), "base64url"), aad(column)).toString("utf8");
      },
      phoneHash: (e164) => createHmac("sha256", keys.pepper).update(e164).digest("hex"),
    };
  }

  /** Forget cached keys (tests; after a tenant key rotation). */
  forget(tenantId: string): void {
    this.cache.delete(tenantId);
  }

  private async load(trx: Transaction<DB>, tenantId: string): Promise<Keys> {
    // Lock the tenant row: two first uses at once must not create two keys.
    const tenant = await trx.selectFrom("tenants").select("settings").where("id", "=", tenantId).forUpdate().executeTakeFirstOrThrow();
    const settings = (typeof tenant.settings === "string" ? JSON.parse(tenant.settings) : tenant.settings ?? {}) as Record<string, unknown>;
    let ref = typeof settings.piiKeyRef === "string" ? settings.piiKeyRef : undefined;
    let material: Buffer;
    if (ref) {
      material = Buffer.from((await this.secrets.read(trx, tenantId, ref)).reveal(), "base64");
    } else {
      material = randomBytes(32);
      ref = await this.secrets.create(trx, tenantId, material.toString("base64"), { actor: { type: "system" } });
      await trx.updateTable("tenants").set({ settings: JSON.stringify({ ...settings, piiKeyRef: ref }) }).where("id", "=", tenantId).execute();
    }
    const derive = (info: string) => Buffer.from(hkdfSync("sha256", material, Buffer.alloc(0), info, 32));
    const keys = { enc: derive("mizan-pii-encryption-v1"), pepper: derive("mizan-phone-hash-v1") };
    material.fill(0);
    return keys;
  }
}

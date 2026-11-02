import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Wraps (encrypts) and unwraps per-secret data keys with a key-encryption key.
 * Production: Azure Key Vault (the KEK never leaves the vault). Dev/test: a local AES key.
 */
export interface KeyWrapper {
  wrap(dataKey: Buffer): Promise<{ wrapped: Buffer; keyVersion: string }>;
  unwrap(wrapped: Buffer, keyVersion: string): Promise<Buffer>;
  /** Version new wraps use; secrets wrapped with another version are re-wrapped by rewrapStale(). */
  currentVersion(): Promise<string>;
}

export const KEY_WRAPPER = Symbol("KEY_WRAPPER");

const IV = 12;
const TAG = 16;

/** AES-256-GCM seal: iv | tag | ciphertext. */
export function seal(key: Buffer, plaintext: Buffer, aad: Buffer): Buffer {
  const iv = randomBytes(IV);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

export function open(key: Buffer, sealed: Buffer, aad: Buffer): Buffer {
  if (sealed.length < IV + TAG) throw new Error("sealed value too short");
  const decipher = createDecipheriv("aes-256-gcm", key, sealed.subarray(0, IV));
  decipher.setAAD(aad);
  decipher.setAuthTag(sealed.subarray(IV, IV + TAG));
  return Buffer.concat([decipher.update(sealed.subarray(IV + TAG)), decipher.final()]);
}

/** Dev/test KEK held in process memory. Not for production (config refuses it there). */
export class LocalKeyWrapper implements KeyWrapper {
  private readonly version: string;

  constructor(private readonly kek: Buffer, label = "local-v1") {
    if (kek.length !== 32) throw new Error("local key-encryption key must be 32 bytes");
    this.version = label;
  }

  static ephemeral(): LocalKeyWrapper {
    return new LocalKeyWrapper(randomBytes(32), "local-ephemeral");
  }

  async wrap(dataKey: Buffer) {
    return { wrapped: seal(this.kek, dataKey, Buffer.from(this.version)), keyVersion: this.version };
  }

  async unwrap(wrapped: Buffer, keyVersion: string) {
    if (keyVersion !== this.version) throw new Error(`no local key for version ${keyVersion}`);
    return open(this.kek, wrapped, Buffer.from(keyVersion));
  }

  async currentVersion() {
    return this.version;
  }
}

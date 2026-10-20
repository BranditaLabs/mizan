import type { KeyWrapper } from "./key-wrapper.js";

type Fetch = typeof fetch;

const METADATA_TOKEN_URL = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

/**
 * Cloud KMS key wrapper over the REST API (no SDK): encrypt/decrypt a data key
 * with a symmetric CryptoKey. Credentials: the Cloud Run service account via
 * the metadata server. `keyVersion` records the CryptoKeyVersion that wrapped
 * a key; KMS decrypt finds the right version itself.
 */
export class CloudKmsKeyWrapper implements KeyWrapper {
  private token?: { value: string; expiresAt: number };
  private primary?: { name: string; at: number };

  constructor(
    private readonly keyName: string,
    private readonly http: Fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {
    if (!/^projects\/[^/]+\/locations\/[^/]+\/keyRings\/[^/]+\/cryptoKeys\/[^/]+$/.test(keyName)) {
      throw new Error("KMS_KEY_NAME must look like projects/<p>/locations/<l>/keyRings/<r>/cryptoKeys/<k>");
    }
  }

  async wrap(dataKey: Buffer) {
    const res = await this.call<{ name: string; ciphertext: string }>(`${this.keyName}:encrypt`, { plaintext: dataKey.toString("base64") });
    return { wrapped: Buffer.from(res.ciphertext, "base64"), keyVersion: res.name };
  }

  async unwrap(wrapped: Buffer) {
    const res = await this.call<{ plaintext: string }>(`${this.keyName}:decrypt`, { ciphertext: wrapped.toString("base64") });
    return Buffer.from(res.plaintext, "base64");
  }

  async currentVersion() {
    if (!this.primary || this.now() - this.primary.at > 300_000) {
      const key = await this.call<{ primary?: { name: string } }>(this.keyName, undefined, "GET");
      if (!key.primary?.name) throw new Error("KMS key has no primary version");
      this.primary = { name: key.primary.name, at: this.now() };
    }
    return this.primary.name;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - 60_000 > this.now()) return this.token.value;
    const res = await this.http(METADATA_TOKEN_URL, { headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(5_000) });
    if (!res.ok) throw new Error(`metadata token request failed: ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: body.access_token, expiresAt: this.now() + body.expires_in * 1000 };
    return this.token.value;
  }

  private async call<T>(path: string, body: unknown, method = "POST"): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      const res = await this.http(`https://cloudkms.googleapis.com/v1/${path}`, {
        method,
        headers: { Authorization: `Bearer ${await this.accessToken()}`, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return (await res.json()) as T;
      // Retry once on throttling and server errors; never echo the response body (it may quote input).
      if (attempt < 2 && (res.status === 429 || res.status >= 500)) {
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }
      throw new Error(`Cloud KMS ${method} ${path.split(":").pop()} failed: ${res.status}`);
    }
  }
}

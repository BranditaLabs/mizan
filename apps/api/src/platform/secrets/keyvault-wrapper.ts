import type { KeyWrapper } from "./key-wrapper.js";

type Fetch = typeof fetch;

const API_VERSION = "7.4";
const ALG = "RSA-OAEP-256";
const KEY_ID = /^https:\/\/[a-z0-9-]{3,24}\.vault\.azure\.net\/keys\/[A-Za-z0-9-]{1,127}$/;
const VERSION = /^[0-9a-f]{32}$/;

/** Where the container's managed identity gets tokens (Azure Container Apps sets both). */
export interface ManagedIdentity {
  endpoint: string;
  header: string;
  /** The user-assigned identity's client id; empty for the system-assigned one. */
  clientId?: string | undefined;
}

/**
 * Azure Key Vault key wrapper over the REST API (no SDK): wrapkey/unwrapkey a data key with an RSA
 * key that never leaves the vault. Credentials: the container's managed identity. `keyVersion` is
 * the full key id of the version that wrapped a key (Key Vault needs it to unwrap); a new key
 * version (rotation) becomes current, and rewrapStale() moves older secrets onto it.
 */
export class KeyVaultKeyWrapper implements KeyWrapper {
  private token?: { value: string; expiresAt: number };
  private current?: { kid: string; at: number };

  constructor(
    private readonly keyId: string,
    private readonly identity: ManagedIdentity | null,
    private readonly http: Fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {
    if (!KEY_ID.test(keyId)) throw new Error("KEY_VAULT_KEY_ID must look like https://<vault>.vault.azure.net/keys/<name> (no version)");
  }

  async wrap(dataKey: Buffer) {
    const kid = await this.currentVersion();
    const res = await this.call<{ kid: string; value: string }>(`${kid}/wrapkey`, { alg: ALG, value: dataKey.toString("base64url") });
    return { wrapped: Buffer.from(res.value, "base64url"), keyVersion: this.checkKid(res.kid) };
  }

  async unwrap(wrapped: Buffer, keyVersion: string) {
    // The version comes from the database: only ever call this vault's own key with it.
    const res = await this.call<{ value: string }>(`${this.checkKid(keyVersion)}/unwrapkey`, { alg: ALG, value: wrapped.toString("base64url") });
    return Buffer.from(res.value, "base64url");
  }

  async currentVersion() {
    if (!this.current || this.now() - this.current.at > 300_000) {
      const key = await this.call<{ key?: { kid?: string } }>(this.keyId, undefined, "GET");
      if (!key.key?.kid) throw new Error("Key Vault key has no current version");
      this.current = { kid: this.checkKid(key.key.kid), at: this.now() };
    }
    return this.current.kid;
  }

  private checkKid(kid: string): string {
    const version = kid.startsWith(`${this.keyId}/`) ? kid.slice(this.keyId.length + 1) : "";
    if (!VERSION.test(version)) throw new Error("not a version of the configured Key Vault key");
    return kid;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - 60_000 > this.now()) return this.token.value;
    if (!this.identity) throw new Error("no managed identity (IDENTITY_ENDPOINT and IDENTITY_HEADER are not set)");
    const url = new URL(this.identity.endpoint);
    url.searchParams.set("api-version", "2019-08-01");
    url.searchParams.set("resource", "https://vault.azure.net");
    if (this.identity.clientId) url.searchParams.set("client_id", this.identity.clientId);
    const res = await this.http(url, { headers: { "X-IDENTITY-HEADER": this.identity.header }, signal: AbortSignal.timeout(5_000) });
    if (!res.ok) throw new Error(`managed identity token request failed: ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_on: string | number };
    this.token = { value: body.access_token, expiresAt: Number(body.expires_on) * 1000 };
    return this.token.value;
  }

  private async call<T>(url: string, body: unknown, method = "POST"): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      const res = await this.http(`${url}?api-version=${API_VERSION}`, {
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
      throw new Error(`Key Vault ${method} ${body === undefined ? "key" : url.split("/").pop()} failed: ${res.status}`);
    }
  }
}

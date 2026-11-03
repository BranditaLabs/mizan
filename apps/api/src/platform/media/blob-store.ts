import type { ManagedIdentity } from "../secrets/keyvault-wrapper.js";

type Fetch = typeof fetch;
const API_VERSION = "2023-11-03";

/**
 * Azure Blob Storage over its REST API (no SDK), with the container's managed identity (P3): put,
 * get and delete one blob. `containerUrl` is https://<account>.blob.core.windows.net/<container>;
 * keys are Mizan's (tenant/…), checked before they reach a URL. Errors never echo the response.
 */
export class BlobStore {
  private token?: { value: string; expiresAt: number };

  constructor(
    private readonly containerUrl: string,
    private readonly identity: ManagedIdentity | null,
    private readonly http: Fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    const res = await this.call("PUT", key, {
      body: bytes, headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": contentType, "x-ms-blob-content-type": contentType, "x-ms-blob-cache-control": "public, max-age=31536000, immutable" },
    });
    if (res.status !== 201) throw new Error(`Blob put failed: ${res.status}`);
  }

  async get(key: string): Promise<Buffer | null> {
    const res = await this.call("GET", key);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Blob get failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async remove(key: string): Promise<void> {
    const res = await this.call("DELETE", key);
    if (!res.ok && res.status !== 404) throw new Error(`Blob delete failed: ${res.status}`);
  }

  private async call(method: string, key: string, init: { body?: Buffer; headers?: Record<string, string> } = {}): Promise<Response> {
    if (!/^[a-z0-9/_.-]{1,200}$/.test(key) || key.includes("..")) throw new Error("not a media key");
    for (let attempt = 1; ; attempt++) {
      const res = await this.http(`${this.containerUrl}/${key}`, {
        method,
        headers: { Authorization: `Bearer ${await this.accessToken()}`, "x-ms-version": API_VERSION, "x-ms-date": new Date(this.now()).toUTCString(), ...init.headers },
        ...(init.body ? { body: new Uint8Array(init.body) } : {}),
        signal: AbortSignal.timeout(30_000),
      });
      // Retry once on throttling and server errors (put, get and delete of one blob are safe to repeat).
      if (attempt < 2 && (res.status === 429 || res.status >= 500)) {
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }
      return res;
    }
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - 60_000 > this.now()) return this.token.value;
    if (!this.identity) throw new Error("no managed identity (IDENTITY_ENDPOINT and IDENTITY_HEADER are not set)");
    const url = new URL(this.identity.endpoint);
    url.searchParams.set("api-version", "2019-08-01");
    url.searchParams.set("resource", "https://storage.azure.com/");
    if (this.identity.clientId) url.searchParams.set("client_id", this.identity.clientId);
    const res = await this.http(url, { headers: { "X-IDENTITY-HEADER": this.identity.header }, signal: AbortSignal.timeout(5_000) });
    if (!res.ok) throw new Error(`managed identity token request failed: ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_on: string | number };
    this.token = { value: body.access_token, expiresAt: Number(body.expires_on) * 1000 };
    return this.token.value;
  }
}

import { Inject, Injectable } from "@nestjs/common";
import { isIntegrationError, migrateShopifyToken, refreshShopifyToken, type ShopifyGrant } from "@mizan/engine";
import { APP_CONFIG, type AppConfig } from "../platform/config.js";
import { Database } from "../platform/db/database.js";
import { SecretsService } from "../platform/secrets/secrets.service.js";
import { ProviderSecretSchemas, NotConnectedError } from "./connection-resolver.js";
import { ENGINE_RUNTIME, type RuntimeFactory } from "./engine-runtime.js";

/** Refresh this long before the hour is up, so a request never leaves with a token about to lapse. */
export const REFRESH_EARLY_MS = 5 * 60_000;

type Stored = { accessToken: string; refreshToken?: string; expiresAt?: number; refreshExpiresAt?: number };
type Trx = Parameters<Parameters<Database["tenant"]>[1]>[0];

/**
 * The current access token of a Shopify store connection. Shopify's offline tokens expire after an
 * hour and every refresh returns a new refresh token, so two refreshes must never race on one store:
 * the refresh runs under a lock on the connection row, and whoever waited reads the token the first
 * one stored. Tokens are kept in memory until shortly before they lapse.
 *
 * A store connected before expiring tokens holds a non-expiring token, which Shopify now refuses: it
 * is swapped for an expiring pair the first time it is needed, without the merchant.
 */
@Injectable()
export class ShopifyTokens {
  private readonly cache = new Map<string, Stored>();
  /** Non-expiring tokens Shopify would not migrate (revoked, or not ours): used as they are until a reconnect. */
  private readonly unmigratable = new Set<string>();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(Database) private readonly db: Database,
    @Inject(SecretsService) private readonly secrets: SecretsService,
    @Inject(ENGINE_RUNTIME) private readonly runtime: RuntimeFactory,
  ) {}

  /** `force`: Shopify refused the token we sent; refresh unless another request already has. */
  async token(tenantId: string, connectionId: string, force = false): Promise<string> {
    const key = `${tenantId}|${connectionId}`;
    const rt = this.runtime(tenantId);
    const seen = this.cache.get(key);
    if (seen && !force && fresh(seen, rt.clock.now())) return seen.accessToken;

    const stored = await this.db.tenant(tenantId, async (trx) => {
      const row = await trx.selectFrom("connections").select(["secret_ref", "external_account"]).where("id", "=", connectionId).forUpdate().executeTakeFirst();
      if (!row?.secret_ref || !row.external_account) throw new NotConnectedError("the shopify connection has no credentials");
      const parsed = ProviderSecretSchemas.shopify.safeParse(JSON.parse((await this.secrets.read(trx, tenantId, row.secret_ref)).reveal()));
      if (!parsed.success) throw new NotConnectedError("the shopify credentials are incomplete");
      const current: Stored = parsed.data;
      const creds = this.app();

      if (!current.refreshToken) {
        // Without the app's keys (a server without the Shopify app) there is nothing to swap with.
        if (!creds || this.unmigratable.has(key)) return current;
        const app = { shop: row.external_account, ...creds };
        try {
          return await this.keep(trx, tenantId, row.secret_ref, current, await migrateShopifyToken(rt, { ...app, accessToken: current.accessToken }));
        } catch (err) {
          if (!isIntegrationError(err) || err.kind !== "validation") throw err;
          this.unmigratable.add(key);
          return current;
        }
      }
      const replaced = force && seen && current.accessToken !== seen.accessToken;
      if (fresh(current, rt.clock.now()) && (!force || replaced)) return current;
      if (!creds) throw new NotConnectedError("the Shopify app credentials are not set on this server");
      return this.keep(trx, tenantId, row.secret_ref, current, await refreshShopifyToken(rt, { shop: row.external_account, ...creds, refreshToken: current.refreshToken }));
    });
    this.cache.set(key, stored);
    return stored.accessToken;
  }

  /** Forget a connection's token (reconnected, disconnected). */
  forget(tenantId: string, connectionId: string): void {
    this.cache.delete(`${tenantId}|${connectionId}`);
    this.unmigratable.delete(`${tenantId}|${connectionId}`);
  }

  /** Store the new pair before anyone uses it: the token it replaces may already be dead. */
  private async keep(trx: Trx, tenantId: string, ref: string, current: Stored, grant: ShopifyGrant): Promise<Stored> {
    const next: Stored = {
      accessToken: grant.accessToken, refreshToken: grant.refreshToken ?? current.refreshToken,
      expiresAt: grant.expiresAt, refreshExpiresAt: grant.refreshExpiresAt ?? current.refreshExpiresAt,
    };
    await this.secrets.renew(trx, tenantId, ref, JSON.stringify(next));
    return next;
  }

  private app(): { clientId: string; clientSecret: string } | null {
    const { SHOPIFY_API_KEY: clientId, SHOPIFY_API_SECRET: clientSecret } = this.config;
    return clientId && clientSecret ? { clientId, clientSecret } : null;
  }
}

function fresh(t: Stored, now: number): boolean {
  return t.expiresAt === undefined || t.expiresAt - now > REFRESH_EARLY_MS;
}

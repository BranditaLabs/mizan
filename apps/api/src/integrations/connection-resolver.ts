import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { Database } from "../platform/db/database.js";
import { ProblemError } from "../platform/http/problem.js";
import { SecretsService } from "../platform/secrets/secrets.service.js";
import { SecretValue } from "../platform/secrets/secret-value.js";

/** What each provider's secret holds (JSON in `secrets`, referenced by connections.secret_ref). */
export const ProviderSecretSchemas = {
  shopify: z.object({ accessToken: z.string().min(1) }),
  bosta: z.object({ apiKey: z.string().min(1), webhookToken: z.string().min(16) }),
  woocommerce: z.object({ consumerKey: z.string().min(1), consumerSecret: z.string().min(1), webhookSecret: z.string().min(16) }),
} as const;

/** Store platforms Mizan runs an engine for (one engine per store connection). */
export const STORE_PROVIDERS = ["shopify", "woocommerce"] as const;

export interface ResolvedConnections {
  tenantId: string;
  /** The store this engine runs for, whatever its platform. */
  store: { provider: (typeof STORE_PROVIDERS)[number]; connectionId: string; config: Record<string, unknown> };
  shopify?: { connectionId: string; shop: string; accessToken: SecretValue; config: Record<string, unknown>; learned: Record<string, unknown> };
  /** E5-7: a WooCommerce store (keys, and the secret Mizan signs its webhooks with). */
  woocommerce?: { connectionId: string; siteUrl: string; consumerKey: SecretValue; consumerSecret: SecretValue; webhookSecret: SecretValue; config: Record<string, unknown>; learned: Record<string, unknown> };
  bosta?: { connectionId: string; apiKey: SecretValue; webhookToken: SecretValue; config: Record<string, unknown>; learned: Record<string, unknown> };
}

const json = (v: unknown): Record<string, unknown> => (typeof v === "string" ? JSON.parse(v) : (v ?? {})) as Record<string, unknown>;

/** The tenant has no usable store connection: its engine jobs wait until one is connected. */
export class NotConnectedError extends ProblemError {
  constructor(detail: string) {
    super(409, "store_not_connected", detail);
  }
}

/**
 * Loads a tenant's provider connections and decrypts their credentials, in
 * one tenant transaction. Decrypted values stay in memory as SecretValue.
 *
 * A tenant can run several stores, on Shopify or WooCommerce (E2-7, E5-7): each gets its own engine, so
 * `resolve` takes the store's connection id (the oldest store when omitted).
 * The tenant's Bosta account, when connected, serves all of its stores.
 */
@Injectable()
export class ConnectionResolver {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(SecretsService) private readonly secrets: SecretsService,
  ) {}

  /** The tenant's stores that can run (not disconnected), oldest first. */
  async stores(tenantId: string): Promise<string[]> {
    return this.db.tenant(tenantId, async (trx) => (await trx.selectFrom("connections").select("id")
      .where("provider", "in", [...STORE_PROVIDERS]).where("status", "!=", "disconnected").orderBy("created_at").orderBy("id").execute()).map((r) => r.id));
  }

  async resolve(tenantId: string, storeId?: string): Promise<ResolvedConnections> {
    return this.db.tenant(tenantId, async (trx) => {
      const rows = await trx.selectFrom("connections")
        .select(["id", "provider", "external_account", "secret_ref", "config", "status", "learned"])
        .where("provider", "in", [...STORE_PROVIDERS, "bosta"]).where("status", "!=", "disconnected")
        .orderBy("created_at").orderBy("id").execute();
      const stores = rows.filter((r) => (STORE_PROVIDERS as readonly string[]).includes(r.provider));
      const bosta = rows.find((r) => r.provider === "bosta");
      if (stores.length === 0) throw new NotConnectedError("no store is connected");
      const store = storeId ? stores.find((r) => r.id === storeId) : stores[0];
      if (!store) throw new NotConnectedError("this store is not connected");
      if (!store.secret_ref || !store.external_account) throw new NotConnectedError(`the ${store.provider} connection has no credentials`);

      const read = async <S extends keyof typeof ProviderSecretSchemas>(provider: S, ref: string) => {
        const raw = (await this.secrets.read(trx, tenantId, ref)).reveal();
        let json: unknown;
        try {
          json = JSON.parse(raw);
        } catch {
          throw new NotConnectedError(`the ${provider} credentials are unreadable`);
        }
        const parsed = ProviderSecretSchemas[provider].safeParse(json);
        if (!parsed.success) throw new NotConnectedError(`the ${provider} credentials are incomplete`);
        return parsed.data as z.infer<(typeof ProviderSecretSchemas)[S]>;
      };

      const provider = store.provider as (typeof STORE_PROVIDERS)[number];
      const resolved: ResolvedConnections = { tenantId, store: { provider, connectionId: store.id, config: json(store.config) } };
      if (provider === "shopify") {
        const s = await read("shopify", store.secret_ref);
        resolved.shopify = { connectionId: store.id, shop: store.external_account, accessToken: new SecretValue(s.accessToken), config: json(store.config), learned: json(store.learned) };
      } else {
        const w = await read("woocommerce", store.secret_ref);
        const config = json(store.config);
        resolved.woocommerce = {
          connectionId: store.id, siteUrl: typeof config.siteUrl === "string" ? config.siteUrl : `https://${store.external_account}`,
          consumerKey: new SecretValue(w.consumerKey), consumerSecret: new SecretValue(w.consumerSecret), webhookSecret: new SecretValue(w.webhookSecret),
          config, learned: json(store.learned),
        };
      }
      if (bosta?.secret_ref) {
        const b = await read("bosta", bosta.secret_ref);
        resolved.bosta = {
          connectionId: bosta.id,
          apiKey: new SecretValue(b.apiKey),
          webhookToken: new SecretValue(b.webhookToken),
          config: json(bosta.config),
          learned: json(bosta.learned),
        };
      }
      return resolved;
    });
  }
}

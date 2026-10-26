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
} as const;

export interface ResolvedConnections {
  tenantId: string;
  shopify: { connectionId: string; shop: string; accessToken: SecretValue; learned: Record<string, unknown> };
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
 * A tenant can run several Shopify stores (E2-7): each gets its own engine, so
 * `resolve` takes the store's connection id (the oldest store when omitted).
 * The tenant's Bosta account, when connected, serves all of its stores.
 */
@Injectable()
export class ConnectionResolver {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(SecretsService) private readonly secrets: SecretsService,
  ) {}

  /** The tenant's Shopify stores that can run (not disconnected), oldest first. */
  async stores(tenantId: string): Promise<string[]> {
    return this.db.tenant(tenantId, async (trx) => (await trx.selectFrom("connections").select("id")
      .where("provider", "=", "shopify").where("status", "!=", "disconnected").orderBy("created_at").orderBy("id").execute()).map((r) => r.id));
  }

  async resolve(tenantId: string, storeId?: string): Promise<ResolvedConnections> {
    return this.db.tenant(tenantId, async (trx) => {
      const rows = await trx.selectFrom("connections")
        .select(["id", "provider", "external_account", "secret_ref", "config", "status", "learned"])
        .where("provider", "in", ["shopify", "bosta"]).where("status", "!=", "disconnected")
        .orderBy("created_at").orderBy("id").execute();
      const shopify = rows.filter((r) => r.provider === "shopify");
      const bosta = rows.find((r) => r.provider === "bosta");
      if (shopify.length === 0) throw new NotConnectedError("no Shopify store is connected");
      const store = storeId ? shopify.find((r) => r.id === storeId) : shopify[0];
      if (!store) throw new NotConnectedError("this Shopify store is not connected");
      if (!store.secret_ref || !store.external_account) throw new NotConnectedError("the Shopify connection has no credentials");

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

      const s = await read("shopify", store.secret_ref);
      const resolved: ResolvedConnections = {
        tenantId,
        shopify: { connectionId: store.id, shop: store.external_account, accessToken: new SecretValue(s.accessToken), learned: json(store.learned) },
      };
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

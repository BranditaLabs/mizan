import { Inject, Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";
import type { DB } from "@mizan/db";
import { defaultRuntime, DriftMonitor, LogMessaging, WhatsAppCloudConnector, type MessagingProvider, type WhatsAppChat } from "@mizan/engine";
import { APP_CONFIG, type AppConfig } from "../../platform/config.js";
import { Database } from "../../platform/db/database.js";
import { SecretsService } from "../../platform/secrets/secrets.service.js";
import { engineLogger, ENGINE_RUNTIME, type RuntimeFactory } from "../../integrations/engine-registry.js";

/** Channels a store can use for confirmation; the team can always call. */
export interface StoreChannels { whatsapp: boolean; call_auto: boolean; call_team: true }

export interface StoreMessaging {
  /** The store's WhatsApp number (WhatsApp Cloud, E6-10), or a vendor that pretends (log, tests). */
  whatsapp: (MessagingProvider & Partial<WhatsAppChat>) | null;
  /** Its connection, for the transcript. */
  whatsappConnectionId: string | null;
  /** Automated calls (E6-8): none until a voice vendor is chosen. */
  voice: MessagingProvider | null;
}

/** A WhatsApp connector that can chat (buttons, lists, text), not only send the template. */
export const canChat = (p: unknown): p is MessagingProvider & WhatsAppChat =>
  Boolean(p && typeof (p as WhatsAppChat).sendTemplate === "function" && typeof (p as WhatsAppChat).sendText === "function");

const TTL_MS = 5 * 60_000;

/**
 * Which messaging each store can use (E6-7, E6-10). WhatsApp comes from the store's own WhatsApp
 * Cloud connection (status active: credentials saved and the confirmation template approved);
 * automated calls from the configured vendor (none until E6-8). Connectors are cached per store
 * for a few minutes so circuit breakers and rate buckets live across sends; `invalidate` on change.
 */
@Injectable()
export class MessagingRegistry {
  private override: MessagingProvider | null | undefined;
  private readonly configured: MessagingProvider | null;
  private readonly cache = new Map<string, { at: number; key: string; whatsapp: WhatsAppCloudConnector }>();
  readonly drift = new DriftMonitor();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(Database) private readonly db: Database,
    @Inject(SecretsService) private readonly secrets: SecretsService,
    @Inject(ENGINE_RUNTIME) private readonly runtime: RuntimeFactory,
  ) {
    this.configured = config.MESSAGING_PROVIDER === "log" ? new LogMessaging(defaultRuntime().logger) : null;
  }

  /** Tests: the vendor for calls (and WhatsApp when the store has no WhatsApp connection); null = none; undefined restores config. */
  use(provider: MessagingProvider | null | undefined): void {
    this.override = provider;
  }

  private get vendor(): MessagingProvider | null {
    return this.override !== undefined ? this.override : this.configured;
  }

  invalidate(tenantId: string): void {
    this.cache.delete(tenantId);
  }

  /** The store's messaging, read in the caller's transaction (or a new one). */
  async forTenant(tenantId: string, trx?: Transaction<DB>): Promise<StoreMessaging> {
    const read = async (t: Transaction<DB>) => {
      const c = await t.selectFrom("connections").select(["id", "external_account", "secret_ref", "config", "updated_at"])
        .where("kind", "=", "whatsapp").where("provider", "=", "whatsapp_cloud").where("status", "=", "active").orderBy("created_at", "desc").executeTakeFirst();
      if (!c?.secret_ref || !c.external_account) return null;
      const key = `${c.id}:${c.updated_at.getTime()}`;
      const hit = this.cache.get(tenantId);
      if (hit && hit.key === key && Date.now() - hit.at < TTL_MS) return { id: c.id, whatsapp: hit.whatsapp };
      const secret = JSON.parse((await this.secrets.read(t, tenantId, c.secret_ref)).reveal()) as { accessToken?: string };
      const wabaId = (c.config as { wabaId?: unknown } | null)?.wabaId;
      if (!secret.accessToken || typeof wabaId !== "string") return null;
      const whatsapp = this.connector(tenantId, { phoneNumberId: c.external_account, wabaId, accessToken: secret.accessToken });
      this.cache.set(tenantId, { at: Date.now(), key, whatsapp });
      return { id: c.id, whatsapp };
    };
    const wa = trx ? await read(trx) : await this.db.tenant(tenantId, read);
    const vendor = this.vendor;
    return {
      whatsapp: wa?.whatsapp ?? (vendor?.channels.has("whatsapp") ? vendor : null),
      whatsappConnectionId: wa?.id ?? null,
      voice: vendor?.channels.has("voice") ? vendor : null,
    };
  }

  async channels(tenantId: string, trx?: Transaction<DB>): Promise<StoreChannels> {
    const m = await this.forTenant(tenantId, trx);
    return { whatsapp: Boolean(m.whatsapp), call_auto: Boolean(m.voice), call_team: true };
  }

  /** A connector for given credentials (also used to check them before the connection is active). */
  connector(tenantId: string, creds: { phoneNumberId: string; wabaId: string; accessToken: string }): WhatsAppCloudConnector {
    const rt = this.runtime(tenantId);
    return new WhatsAppCloudConnector(
      { ...creds, baseUrl: this.config.WHATSAPP_GRAPH_URL, graphVersion: this.config.WHATSAPP_GRAPH_VERSION },
      { ...rt, logger: engineLogger(tenantId) }, this.drift,
    );
  }
}

import { Inject, Injectable, Logger } from "@nestjs/common";
import { AuditService } from "../platform/audit/audit.service.js";
import { Database } from "../platform/db/database.js";
import { EventsService } from "../platform/events/events.service.js";
import { SecretsService } from "../platform/secrets/secrets.service.js";
import { EngineRegistry } from "./engine-registry.js";
import { WebhookRouter } from "./webhook-router.js";

/**
 * Provider-side end of a connection (E3-4). Shopify's app/uninstalled means the token is already
 * revoked: the connection becomes `disconnected` (reason kept), its credential is deleted, and its
 * queued jobs are dropped — they cannot run, and a reinstall syncs again. Orders and history stay.
 * FX-3a: dropped jobs are kept with status `dropped` and the reason (never deleted), so support can
 * see what the disconnect stopped. A job whose key is asked for again after a reconnect runs again
 * (keys made from the work, such as `ship:{orderId}` or `bosta:ship:{shipmentId}`, which the
 * re-read orders and the sync guardian ask for). A webhook's ingest job is never asked for again by
 * its key (the provider does not resend a webhook it had a 200 for): the reconnect's import and the
 * scheduled poll read those orders again under their own keys. A job dropped while it ran keeps
 * its lease, so a revived copy waits until that run is over.
 * Idempotent: a second call for a disconnected connection does nothing.
 */
@Injectable()
export class ConnectionLifecycle {
  private readonly log = new Logger("Connections");

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(SecretsService) private readonly secrets: SecretsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(EngineRegistry) private readonly registry: EngineRegistry,
    @Inject(WebhookRouter) private readonly router: WebhookRouter,
  ) {}

  async providerRevoked(tenantId: string, connectionId: string, reason: "app_uninstalled"): Promise<boolean> {
    return this.disconnect(tenantId, connectionId, reason, { actor: { type: "system" } });
  }

  /**
   * The team disconnects a store or courier (U7): the same end as an uninstall. Mizan stops
   * syncing, forgets the credential and drops queued jobs; orders and history stay. On Shopify the
   * app stays installed until the owner removes it there (the screen says so).
   */
  async disconnectByTeam(tenantId: string, connectionId: string, by: { actor: { type: "user"; id: string }; ip?: string }): Promise<boolean> {
    return this.disconnect(tenantId, connectionId, "by_team", by);
  }

  private async disconnect(tenantId: string, connectionId: string, reason: "app_uninstalled" | "by_team",
    by: { actor: { type: "system" } | { type: "user"; id: string }; ip?: string }): Promise<boolean> {
    const done = await this.db.tenant(tenantId, async (trx) => {
      const c = await trx.selectFrom("connections").select(["provider", "status", "secret_ref"]).where("id", "=", connectionId).forUpdate().executeTakeFirst();
      if (!c || c.status === "disconnected") return false;
      await trx.updateTable("connections").set({ status: "disconnected", status_reason: reason, secret_ref: null, updated_at: new Date() })
        .where("id", "=", connectionId).execute();
      if (c.secret_ref) await this.secrets.delete(trx, tenantId, c.secret_ref, by);
      const dropped = await trx.updateTable("mz_outbox")
        // locked_until kept: a run still in progress holds its lease; a revival waits it out (REVIVE_DROPPED).
        .set({ status: "dropped", last_error: `connection disconnected (${reason})`, updated_at: Date.now() })
        .where("connection_id", "=", connectionId).where("status", "in", ["pending", "running"]).executeTakeFirst();
      // Products made in Mizan on their way to this store (P3): their job went with it.
      await trx.updateTable("products").set({ publish_status: "failed", publish_error: "the store disconnected Mizan before it had the product" })
        .where("publish_connection_id", "=", connectionId).where("publish_status", "=", "publishing").execute();
      const entity = { type: "connection", id: connectionId };
      await this.audit.record(trx, { action: "connection.disconnected", tenantId, entity, before: { status: c.status }, after: { status: "disconnected", reason, jobsDropped: Number(dropped.numUpdatedRows) }, ...by });
      await this.events.emit(trx, { type: "connection.disconnected", tenantId, entity, data: { provider: c.provider, reason },
        actor: by.actor.type === "user" ? { type: "user", id: by.actor.id } : null });
      return true;
    });
    this.registry.invalidate(tenantId);
    this.router.forget(connectionId);
    if (done) this.log.log({ tenantId, connectionId, reason }, reason === "by_team" ? "connection disconnected by the team" : "connection disconnected by the provider");
    return done;
  }
}

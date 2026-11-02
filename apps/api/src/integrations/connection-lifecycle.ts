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
    const done = await this.db.tenant(tenantId, async (trx) => {
      const c = await trx.selectFrom("connections").select(["provider", "status", "secret_ref"]).where("id", "=", connectionId).forUpdate().executeTakeFirst();
      if (!c || c.status === "disconnected") return false;
      await trx.updateTable("connections").set({ status: "disconnected", status_reason: reason, secret_ref: null, updated_at: new Date() })
        .where("id", "=", connectionId).execute();
      const by = { actor: { type: "system" as const } };
      if (c.secret_ref) await this.secrets.delete(trx, tenantId, c.secret_ref, by);
      const dropped = await trx.deleteFrom("mz_outbox").where("connection_id", "=", connectionId).where("status", "in", ["pending", "running"]).executeTakeFirst();
      const entity = { type: "connection", id: connectionId };
      await this.audit.record(trx, { action: "connection.disconnected", tenantId, entity, before: { status: c.status }, after: { status: "disconnected", reason, jobsDropped: Number(dropped.numDeletedRows) }, ...by });
      await this.events.emit(trx, { type: "connection.disconnected", tenantId, entity, data: { provider: c.provider, reason }, actor: null });
      return true;
    });
    this.registry.invalidate(tenantId);
    this.router.forget(connectionId);
    if (done) this.log.log({ tenantId, connectionId, reason }, "connection disconnected by the provider");
    return done;
  }
}

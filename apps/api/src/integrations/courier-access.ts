import { Inject, Injectable } from "@nestjs/common";
import type { AccessCheck } from "@mizan/engine";
import { AuditService } from "../platform/audit/audit.service.js";
import { Database } from "../platform/db/database.js";
import { EventsService } from "../platform/events/events.service.js";

/**
 * The outcome of the engine's courier key check (bosta.checkAccess, E4-5) on the connection:
 *  accepted → `active` + `connection.connected` (once: the moment the courier really works);
 *  refused  → `needs_attention` with the reason + `connection.needs_attention`.
 * A connection disconnected meanwhile is left alone.
 */
@Injectable()
export class CourierAccess {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async checked(tenantId: string, connectionId: string, provider: "bosta", result: AccessCheck): Promise<void> {
    await this.db.tenant(tenantId, async (trx) => {
      const c = await trx.selectFrom("connections").select(["status", "config"]).where("id", "=", connectionId).forUpdate().executeTakeFirst();
      if (!c || c.status === "disconnected") return;
      const entity = { type: "connection", id: connectionId };
      const by = { actor: { type: "system" as const } };
      if (result.ok) {
        const config = { ...(c.config as Record<string, unknown>), verifiedAt: new Date().toISOString() };
        await trx.updateTable("connections").set({ status: "active", status_reason: null, config: JSON.stringify(config), updated_at: new Date() }).where("id", "=", connectionId).execute();
        if (c.status !== "active") {
          await this.audit.record(trx, { action: "connection.connected", tenantId, entity, before: { status: c.status }, after: { status: "active" }, ...by });
          await this.events.emit(trx, { type: "connection.connected", tenantId, entity, data: { provider, kind: "courier", reconnected: false }, actor: { type: "engine" } });
        }
      } else {
        const reason = result.reason === "auth" ? "key_refused" : "key_lacks_permission";
        await trx.updateTable("connections").set({ status: "needs_attention", status_reason: reason, updated_at: new Date() }).where("id", "=", connectionId).execute();
        await this.audit.record(trx, { action: "connection.needs_attention", tenantId, entity, before: { status: c.status }, after: { status: "needs_attention", reason }, ...by });
        await this.events.emit(trx, { type: "connection.needs_attention", tenantId, entity, data: { provider, kind: "courier", reason }, actor: { type: "engine" } });
      }
    });
  }
}

import { Inject, Injectable } from "@nestjs/common";
import type { BackfillProgress } from "@mizan/engine";
import { AuditService } from "../platform/audit/audit.service.js";
import { Database } from "../platform/db/database.js";
import { EventsService } from "../platform/events/events.service.js";

/**
 * A store's history import ended (A2): `connection.sync_completed` with what came in, or
 * `connection.sync_failed` with the error kind (auth, permission, permanent…), so the team is told
 * and automations can react. The progress itself stays in the engine's record (setup reads it).
 *
 * An import that completes proves the store accepts Mizan again: a connection marked as refused
 * (key_refused, key_lacks_permission) becomes active and is announced as reconnected with
 * `recovered`, which re-registers its webhooks without importing again.
 */
/** The reasons a store's refusal marks its connection (CourierAccess). */
const REFUSED = new Set(["key_refused", "key_lacks_permission"]);

@Injectable()
export class SyncResults {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async record(tenantId: string, connectionId: string, provider: string, p: BackfillProgress): Promise<void> {
    if (p.status === "running") return;
    await this.db.tenant(tenantId, async (trx) => {
      const c = await trx.selectFrom("connections").select(["status", "status_reason"]).where("id", "=", connectionId).forUpdate().executeTakeFirst();
      if (!c || c.status === "disconnected") return;
      const entity = { type: "connection", id: connectionId };
      if (p.status === "done" && c.status === "needs_attention" && REFUSED.has(c.status_reason ?? "")) {
        await trx.updateTable("connections").set({ status: "active", status_reason: null, updated_at: new Date() }).where("id", "=", connectionId).execute();
        await this.audit.record(trx, { action: "connection.connected", tenantId, entity, before: { status: c.status, reason: c.status_reason }, after: { status: "active" }, actor: { type: "system" } });
        await this.events.emit(trx, { type: "connection.connected", tenantId, entity, data: { provider, kind: "store", reconnected: true, recovered: true }, actor: { type: "engine" } });
      }
      await this.events.emit(trx, {
        type: p.status === "done" ? "connection.sync_completed" : "connection.sync_failed",
        tenantId, entity, actor: { type: "engine" },
        data: { provider, kind: "store", runKey: p.runKey, orders: p.orders, products: p.products, ...(p.error ? { errorKind: p.error.kind } : {}) },
      });
    });
  }
}

import { Inject, Injectable } from "@nestjs/common";
import type { BackfillProgress } from "@mizan/engine";
import { Database } from "../platform/db/database.js";
import { EventsService } from "../platform/events/events.service.js";

/**
 * A store's history import ended (A2): `connection.sync_completed` with what came in, or
 * `connection.sync_failed` with the error kind (auth, permission, permanent…), so the team is told
 * and automations can react. The progress itself stays in the engine's record (setup reads it).
 */
@Injectable()
export class SyncResults {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(EventsService) private readonly events: EventsService,
  ) {}

  async record(tenantId: string, connectionId: string, provider: string, p: BackfillProgress): Promise<void> {
    if (p.status === "running") return;
    await this.db.tenant(tenantId, async (trx) => {
      const c = await trx.selectFrom("connections").select("status").where("id", "=", connectionId).executeTakeFirst();
      if (!c || c.status === "disconnected") return;
      await this.events.emit(trx, {
        type: p.status === "done" ? "connection.sync_completed" : "connection.sync_failed",
        tenantId, entity: { type: "connection", id: connectionId }, actor: { type: "engine" },
        data: { provider, kind: "store", runKey: p.runKey, orders: p.orders, products: p.products, ...(p.error ? { errorKind: p.error.kind } : {}) },
      });
    });
  }
}

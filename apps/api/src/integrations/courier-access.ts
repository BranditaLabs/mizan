import { Inject, Injectable } from "@nestjs/common";
import type { AccessCheck } from "@mizan/engine";
import { AuditService } from "../platform/audit/audit.service.js";
import { Database } from "../platform/db/database.js";
import { EventsService } from "../platform/events/events.service.js";

/**
 * The outcome of the engine's key check on the connection — the courier's (bosta.checkAccess, E4-5)
 * or a WooCommerce store's (its webhook sync, E5-7), or a store that refused a job (A2: a Shopify
 * token revoked, keys withdrawn; failures only: the next install or keys, or an import that completes
 * (SyncResults), make it active again):
 *  accepted → `active` + `connection.connected` (once: the moment the courier really works);
 *  refused  → `needs_attention` with the reason + `connection.needs_attention`.
 * A connection disconnected meanwhile is left alone.
 */
/** Shopify would not send some webhook topics (protected customer data not approved for the app). */
export const WEBHOOKS_REFUSED = "webhooks_refused";

@Injectable()
export class CourierAccess {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async checked(tenantId: string, connectionId: string, provider: "bosta" | "woocommerce" | "shopify", result: AccessCheck): Promise<void> {
    const kind = provider === "bosta" ? "courier" : "store";
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
          await this.events.emit(trx, { type: "connection.connected", tenantId, entity, data: { provider, kind, reconnected: false }, actor: { type: "engine" } });
        }
      } else {
        const reason = result.reason === "auth" ? "key_refused" : "key_lacks_permission";
        await trx.updateTable("connections").set({ status: "needs_attention", status_reason: reason, updated_at: new Date() }).where("id", "=", connectionId).execute();
        await this.audit.record(trx, { action: "connection.needs_attention", tenantId, entity, before: { status: c.status }, after: { status: "needs_attention", reason }, ...by });
        await this.events.emit(trx, { type: "connection.needs_attention", tenantId, entity, data: { provider, kind, reason }, actor: { type: "engine" } });
      }
    });
  }

  /**
   * A Shopify store's webhook registration: refused topics (protected customer data not approved for
   * the app) leave the store working on the 5-minute poll, so it stays active with `webhooks_refused`
   * as information; the hourly sync that registers them clears it. A refusal of Mizan itself wins.
   */
  async webhooks(tenantId: string, connectionId: string, result: { ok: true } | { ok: false; message: string }): Promise<void> {
    await this.db.tenant(tenantId, async (trx) => {
      const c = await trx.selectFrom("connections").select(["status", "status_reason"]).where("id", "=", connectionId).forUpdate().executeTakeFirst();
      if (!c || c.status !== "active") return;
      const reason = result.ok ? null : WEBHOOKS_REFUSED;
      if (c.status_reason === reason || (c.status_reason !== null && c.status_reason !== WEBHOOKS_REFUSED)) return;
      await trx.updateTable("connections").set({ status_reason: reason, updated_at: new Date() }).where("id", "=", connectionId).execute();
      await this.audit.record(trx, {
        action: result.ok ? "connection.webhooks_registered" : "connection.webhooks_refused", tenantId, entity: { type: "connection", id: connectionId },
        before: { reason: c.status_reason }, after: { reason }, actor: { type: "system" },
      });
    });
  }
}

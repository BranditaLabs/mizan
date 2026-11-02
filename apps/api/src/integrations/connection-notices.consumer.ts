import { Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";
import type { DB } from "@mizan/db";
import type { DomainEvent } from "@mizan/shared";
import { EventConsumer, type EventHandler } from "../platform/events/consumer.js";

/**
 * Built-in team notifications for connections (A3), no automation to set up: a store's import
 * finished or failed, a store or courier needs attention, a store was disconnected. The text is
 * the facts in a fixed shape ("provider|…"), told in the reader's language by the bell. Owners and
 * admins see them; a courier needing attention also reaches ops managers (they ship).
 */
@Injectable()
@EventConsumer({ name: "integrations.connection-notices", events: ["connection.sync_completed", "connection.sync_failed", "connection.needs_attention", "connection.disconnected"] })
export class ConnectionNoticesConsumer implements EventHandler {
  async handle(event: DomainEvent, trx: Transaction<DB>): Promise<void> {
    const d = event.data as { provider?: string; kind?: string; runKey?: string; orders?: number; products?: number; errorKind?: string; reason?: string };
    const provider = d.provider ?? "store";
    let text: string;
    let dedupe: string;
    if (event.type === "connection.sync_completed" || event.type === "connection.sync_failed") {
      text = [provider, d.orders ?? 0, d.products ?? 0, d.errorKind ?? ""].join("|");
      dedupe = `${event.type}:${d.runKey ?? event.id}`;
    } else if (event.type === "connection.needs_attention") {
      text = [provider, d.reason ?? d.errorKind ?? ""].join("|");
      dedupe = `${event.type}:${event.entity.id}:${event.occurredAt.slice(0, 10)}`; // once a day per connection
    } else {
      text = provider;
      dedupe = `${event.type}:${event.id}`;
    }
    const roles = event.type === "connection.needs_attention" && d.kind === "courier" ? ["owner", "admin", "ops_manager"] : ["owner", "admin"];
    await trx.insertInto("notifications").values({
      tenant_id: event.tenantId, roles, text: text.slice(0, 400), entity_type: "connection", entity_id: event.entity.id, source: event.type, dedupe_key: dedupe,
    }).onConflict((oc) => oc.columns(["tenant_id", "dedupe_key"]).where("dedupe_key", "is not", null).doNothing()).execute();
  }
}

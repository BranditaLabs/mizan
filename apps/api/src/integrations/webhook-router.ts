import { Inject, Injectable } from "@nestjs/common";
import { asWorker } from "@mizan/db";
import { Database } from "../platform/db/database.js";

export interface ConnectionRoute {
  tenantId: string;
  provider: string;
  status: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A backstop: connect, reconnect and disconnect also forget the route in this process (W3/W4). */
const TTL_MS = 10_000;
const MAX = 50_000;

/**
 * connection id → tenant, for webhooks that arrive without a tenant context.
 * Reads only routing columns (migration 0010) and caches them briefly: under a
 * webhook burst, routing costs no database round-trip.
 *
 * FX-3a W3/W4: only a live route is cached. "No such connection" and "disconnected" are read
 * again on every webhook, so a store that connects or reconnects in another process (the API
 * runs several) gets its next webhook routed, never answered from a stale "no route".
 */
@Injectable()
export class WebhookRouter {
  private readonly cache = new Map<string, { route: ConnectionRoute; at: number }>();

  constructor(@Inject(Database) private readonly db: Database) {}

  async route(connectionId: string): Promise<ConnectionRoute | null> {
    if (!UUID.test(connectionId)) return null;
    const hit = this.cache.get(connectionId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.route;
    const row = await asWorker(this.db.kysely, (trx) => trx.selectFrom("connections")
      .select(["tenant_id", "provider", "status"]).where("id", "=", connectionId).executeTakeFirst());
    const route = row ? { tenantId: row.tenant_id, provider: row.provider, status: row.status } : null;
    this.cache.delete(connectionId);
    if (!route || route.status === "disconnected") return route;
    this.cache.set(connectionId, { route, at: Date.now() });
    if (this.cache.size > MAX) this.cache.delete(this.cache.keys().next().value!);
    return route;
  }

  forget(connectionId: string): void {
    this.cache.delete(connectionId);
  }
}

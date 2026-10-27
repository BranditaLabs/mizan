import { sql, type Kysely, type Transaction } from "kysely";
import { asPlatformStaff, asWorker, withoutTenant, withTenant, type DB } from "@mizan/db";

/**
 * The API's handle on PostgreSQL. Inject it; never build Kysely instances in modules.
 *
 * - `tenant(id, fn)`: the normal path. Every module query runs here, under RLS.
 * - `platform(fn)`: app role without a tenant, for tenants/users/memberships lookups.
 * - `worker(fn)`: the worker role, across tenants, only where migrations grant it (event
 *   dispatch, engine jobs, webhook routing, retention, pending Shopify installs).
 * - `kysely`: the raw owner connection, for migrations and signup bootstrap only (E1-6).
 */
export class Database {
  constructor(readonly kysely: Kysely<DB>, private readonly onClose: () => Promise<void> = async () => {}) {}

  tenant<T>(tenantId: string, fn: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
    return withTenant(this.kysely, tenantId, fn);
  }

  platform<T>(fn: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
    return withoutTenant(this.kysely, fn);
  }

  worker<T>(fn: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
    return asWorker(this.kysely, fn);
  }

  /** The back office's role (A-1): staff tables and read-only store metadata across stores. Staff routes only. */
  staff<T>(fn: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
    return asPlatformStaff(this.kysely, fn);
  }

  async ping(): Promise<void> {
    await sql`SELECT 1`.execute(this.kysely);
  }

  async close(): Promise<void> {
    await this.kysely.destroy();
    await this.onClose();
  }
}

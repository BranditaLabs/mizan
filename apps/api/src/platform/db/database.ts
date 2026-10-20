import { sql, type Kysely, type Transaction } from "kysely";
import { withoutTenant, withTenant, type DB } from "@mizan/db";

/**
 * The API's handle on PostgreSQL. Inject it; never build Kysely instances in modules.
 *
 * - `tenant(id, fn)`: the normal path. Every module query runs here, under RLS.
 * - `platform(fn)`: app role without a tenant, for tenants/users/memberships lookups.
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

  async ping(): Promise<void> {
    await sql`SELECT 1`.execute(this.kysely);
  }

  async close(): Promise<void> {
    await this.kysely.destroy();
    await this.onClose();
  }
}

import { sql, type Kysely, type Transaction } from "kysely";
import type { DB } from "./schema.js";

/** The role every tenant transaction runs as (created in migration 0003). */
export const APP_ROLE = "mizan_app";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class InvalidTenantError extends Error {
  constructor() {
    super("tenant id must be a UUID");
    this.name = "InvalidTenantError";
  }
}

/**
 * Run `fn` in a transaction scoped to one tenant.
 *
 * The transaction switches to the app role (no BYPASSRLS, owns nothing) and
 * sets `app.tenant_id`, so every RLS policy filters to this tenant — even if
 * a query forgets a `where tenant_id = …`. Both settings are LOCAL: they end
 * with the transaction and never leak to the next user of the connection.
 */
export async function withTenant<T>(db: Kysely<DB>, tenantId: string, fn: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
  if (!UUID.test(tenantId)) throw new InvalidTenantError();
  return db.transaction().execute(async (trx) => {
    await sql`SET LOCAL ROLE ${sql.raw(APP_ROLE)}`.execute(trx);
    await sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`.execute(trx);
    return fn(trx);
  });
}

/**
 * Run `fn` as the app role with no tenant: tenant tables return nothing.
 * For platform lookups (tenants, users, memberships by user) before a tenant is chosen.
 */
export async function withoutTenant<T>(db: Kysely<DB>, fn: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`SET LOCAL ROLE ${sql.raw(APP_ROLE)}`.execute(trx);
    return fn(trx);
  });
}

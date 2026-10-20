import { CompiledQuery, sql, type Kysely, type Transaction } from "kysely";
import type { DB } from "./schema.js";

/** The role every tenant transaction runs as (created in migration 0003). */
export const APP_ROLE = "mizan_app";
/** The event dispatcher's role: domain_events across tenants, nothing else (migration 0006). */
export const WORKER_ROLE = "mizan_worker";

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
    // One round-trip: set_config('role', …, true) is SET LOCAL ROLE.
    await sql`SELECT set_config('role', ${APP_ROLE}, true), set_config('app.tenant_id', ${tenantId}, true)`.execute(trx);
    return fn(trx);
  });
}

/**
 * Run `fn` as the app role with no tenant: tenant tables return nothing.
 * For platform lookups (tenants, users, memberships by user) before a tenant is chosen.
 */
export async function withoutTenant<T>(db: Kysely<DB>, fn: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`SELECT set_config('role', ${APP_ROLE}, true)`.execute(trx);
    return fn(trx);
  });
}

/**
 * Mark the signed-in user inside a transaction. LOCAL: ends with the transaction.
 * Enables the self-read policies: member_self_read (0004) by user id, and
 * invitee_read (0005) by email/phone. Pass `email` only when the identity
 * provider verified it; phones come from OTP sign-in.
 */
export async function setActingUser(
  trx: Transaction<DB>,
  userId: string,
  contact: { email?: string; phone?: string } = {},
): Promise<void> {
  if (!UUID.test(userId)) throw new Error("user id must be a UUID");
  await sql`SELECT set_config('app.user_id', ${userId}, true),
                   set_config('app.user_email', ${contact.email?.toLowerCase() ?? ""}, true),
                   set_config('app.user_phone', ${contact.phone ?? ""}, true)`.execute(trx);
}

/** Run `fn` as the dispatcher role (cross-tenant access to domain_events only). */
export async function asWorker<T>(db: Kysely<DB>, fn: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`SELECT set_config('role', ${WORKER_ROLE}, true)`.execute(trx);
    return fn(trx);
  });
}

/** A `query(text, params)` client on an open transaction (e.g. an event consumer's), so engine writes commit with it. */
export function trxQueryClient(trx: Transaction<DB>) {
  return {
    async query<R = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<{ rows: R[] }> {
      const res = await trx.executeQuery<R>(CompiledQuery.raw(text, params));
      return { rows: [...res.rows] };
    },
  };
}

/**
 * A minimal `query(text, params)` client bound to one tenant: each call runs
 * in its own withTenant transaction (app role + app.tenant_id), so RLS
 * applies to every statement. Used to run the engine's SqlStore inside the platform.
 */
export function tenantQueryClient(db: Kysely<DB>, tenantId: string) {
  return {
    async query<R = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<{ rows: R[] }> {
      const res = await withTenant(db, tenantId, (trx) => trx.executeQuery<R>(CompiledQuery.raw(text, params)));
      return { rows: [...res.rows] };
    },
  };
}

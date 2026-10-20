import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPglite, createPgliteDb, pgliteMigrationClient } from "../src/clients.js";
import { migrate } from "../src/migrate.js";
import { asWorker, InvalidTenantError, setActingUser, withoutTenant, withTenant } from "../src/tenant.js";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";

const pglite = await createPglite();
const db = createPgliteDb(pglite);

beforeAll(async () => {
  await migrate(pgliteMigrationClient(pglite));
  // Platform rows are created by the migrator (owner), as signup will do in E1-6.
  await db.insertInto("tenants").values([{ id: A, name: "Store A", slug: "store-a" }, { id: B, name: "Store B", slug: "store-b" }]).execute();
});
afterAll(() => pglite.close());

const order = (tenant: string, number: string, total: bigint) =>
  ({ tenant_id: tenant, number, currency: "EGP", total_minor: total, placed_at: new Date() });

describe("withTenant", () => {
  it("tenant A cannot read or write tenant B's rows", async () => {
    await withTenant(db, A, (trx) => trx.insertInto("orders").values(order(A, "#A-1", 115000n)).execute());
    await withTenant(db, B, (trx) => trx.insertInto("orders").values(order(B, "#B-1", 64000n)).execute());

    // No WHERE tenant_id: RLS does the filtering.
    const seenByA = await withTenant(db, A, (trx) => trx.selectFrom("orders").select(["number", "total_minor"]).execute());
    expect(seenByA).toEqual([{ number: "#A-1", total_minor: 115000n }]);

    await expect(withTenant(db, A, (trx) => trx.insertInto("orders").values(order(B, "#forged", 1n)).execute()))
      .rejects.toThrow(/row-level security/);

    const updated = await withTenant(db, A, (trx) => trx.updateTable("orders").set({ custom_status: "x" }).where("number", "=", "#B-1").executeTakeFirst());
    expect(updated.numUpdatedRows).toBe(0n);
  });

  it("settings do not leak to the next transaction on the same connection", async () => {
    await withTenant(db, A, async () => {});
    const after = await db.transaction().execute(async (trx) =>
      (await sql<{ role: string; tenant: string | null }>`SELECT current_user AS role, NULLIF(current_setting('app.tenant_id', true), '') AS tenant`.execute(trx)).rows[0]);
    expect(after).toEqual({ role: "postgres", tenant: null });
  });

  it("rolls back everything when the callback throws", async () => {
    await expect(withTenant(db, A, async (trx) => {
      await trx.insertInto("orders").values(order(A, "#A-rollback", 1n)).execute();
      throw new Error("boom");
    })).rejects.toThrow("boom");
    const numbers = await withTenant(db, A, (trx) => trx.selectFrom("orders").select("number").execute());
    expect(numbers.map((r) => r.number)).not.toContain("#A-rollback");
  });

  it("rejects a non-UUID tenant id before touching the database", async () => {
    await expect(withTenant(db, "a' OR '1'='1", async () => 1)).rejects.toBeInstanceOf(InvalidTenantError);
  });
});

describe("withoutTenant", () => {
  it("sees platform tables but no tenant rows", async () => {
    const result = await withoutTenant(db, async (trx) => ({
      tenants: (await trx.selectFrom("tenants").select("slug").orderBy("slug").execute()).map((t) => t.slug),
      orders: await trx.selectFrom("orders").selectAll().execute(),
    }));
    expect(result).toEqual({ tenants: ["store-a", "store-b"], orders: [] });
  });

  it("the app role cannot touch the migration ledger", async () => {
    await expect(withoutTenant(db, (trx) => trx.selectFrom("schema_migrations").selectAll().execute()))
      .rejects.toThrow(/permission denied/);
  });
});

describe("member_self_read (migration 0004)", () => {
  it("a user sees their own memberships in every tenant, and nobody else's", async () => {
    const [sara, omar] = await db.insertInto("users").values([{ firebase_uid: "fb-sara" }, { firebase_uid: "fb-omar" }]).returning("id").execute();
    await db.insertInto("memberships").values([
      { tenant_id: A, user_id: sara!.id, role: "owner" },
      { tenant_id: B, user_id: sara!.id, role: "agent" },
      { tenant_id: A, user_id: omar!.id, role: "warehouse" },
    ]).execute();

    const mine = await withoutTenant(db, async (trx) => {
      await setActingUser(trx, sara!.id);
      return trx.selectFrom("memberships").select(["tenant_id", "role"]).orderBy("role").execute();
    });
    expect(mine).toEqual([{ tenant_id: B, role: "agent" }, { tenant_id: A, role: "owner" }]);

    // Without app.user_id: nothing. Writes still need the tenant context.
    expect(await withoutTenant(db, (trx) => trx.selectFrom("memberships").selectAll().execute())).toEqual([]);
    await expect(withoutTenant(db, async (trx) => {
      await setActingUser(trx, sara!.id);
      await trx.insertInto("memberships").values({ tenant_id: B, user_id: omar!.id, role: "owner" }).execute();
    })).rejects.toThrow(/row-level security/);
    await expect(withoutTenant(db, (trx) => setActingUser(trx, "nope"))).rejects.toThrow(/UUID/);
  });
});

describe("audit_log (migration 0007)", () => {
  it("is tenant-scoped, append-only for the app role, and keeps platform entries private", async () => {
    await withTenant(db, A, (trx) => trx.insertInto("audit_log").values({ tenant_id: A, actor_type: "user", action: "member.invited" }).execute());
    await withTenant(db, B, (trx) => trx.insertInto("audit_log").values({ tenant_id: B, actor_type: "user", action: "member.removed" }).execute());
    await withoutTenant(db, (trx) => trx.insertInto("audit_log").values({ tenant_id: null, actor_type: "user", action: "user.signed_in" }).execute());

    expect(await withTenant(db, A, (trx) => trx.selectFrom("audit_log").select("action").execute())).toEqual([{ action: "member.invited" }]);
    expect(await withoutTenant(db, (trx) => trx.selectFrom("audit_log").select("action").execute())).toEqual([]);
    await expect(withTenant(db, A, (trx) => trx.updateTable("audit_log").set({ action: "nothing.happened" }).execute())).rejects.toThrow(/permission denied/);
    await expect(withTenant(db, A, (trx) => trx.deleteFrom("audit_log").execute())).rejects.toThrow(/permission denied/);
    await expect(withTenant(db, A, (trx) => trx.insertInto("audit_log").values({ tenant_id: B, actor_type: "user", action: "forged" }).execute())).rejects.toThrow(/row-level security/);
  });
});

describe("connection routing (migration 0010)", () => {
  it("the worker role reads only routing columns of connections, across tenants", async () => {
    await withTenant(db, A, (trx) => trx.insertInto("connections").values({ tenant_id: A, kind: "store", provider: "shopify", external_account: "a.myshopify.com", secret_ref: "s1", config: JSON.stringify({ k: 1 }) }).execute());
    const rows = await asWorker(db, (trx) => trx.selectFrom("connections").select(["id", "tenant_id", "provider", "status"]).execute());
    expect(rows.map((r) => r.tenant_id)).toContain(A);
    await expect(asWorker(db, (trx) => trx.selectFrom("connections").select(["secret_ref"]).execute())).rejects.toThrow(/permission denied/);
    await expect(asWorker(db, (trx) => trx.selectFrom("connections").select(["config"]).execute())).rejects.toThrow(/permission denied/);
    await expect(asWorker(db, (trx) => trx.updateTable("connections").set({ status: "active" }).execute())).rejects.toThrow(/permission denied/);
  });
});

describe("worker deletes (migration 0012)", () => {
  it("the worker can delete only dispatched events and done jobs, never live work", async () => {
    const ids = { live: crypto.randomUUID(), done: crypto.randomUUID() };
    await withTenant(db, A, (trx) => trx.insertInto("domain_events").values([
      { id: ids.live, tenant_id: A, type: "order.created", entity_type: "order", entity_id: A },
      { id: ids.done, tenant_id: A, type: "order.created", entity_type: "order", entity_id: A, dispatched_at: new Date() },
    ]).execute());
    const job = (key: string, status: string) => ({ id: crypto.randomUUID(), tenant_id: A, kind: "k", connection: "shopify", payload: "{}", idempotency_key: key, status, next_attempt_at: 1, created_at: 1, updated_at: 1 });
    await withTenant(db, A, (trx) => trx.insertInto("mz_outbox").values([job("w-pending", "pending"), job("w-dead", "dead"), job("w-done", "done")]).execute());

    const ev = await asWorker(db, (trx) => trx.deleteFrom("domain_events").where("id", "in", [ids.live, ids.done]).executeTakeFirst());
    expect(ev.numDeletedRows).toBe(1n);
    const jobs = await asWorker(db, (trx) => trx.deleteFrom("mz_outbox").where("idempotency_key", "like", "w-%").executeTakeFirst());
    expect(jobs.numDeletedRows).toBe(1n);
    const left = await withTenant(db, A, (trx) => trx.selectFrom("mz_outbox").select("status").where("idempotency_key", "like", "w-%").orderBy("status").execute());
    expect(left.map((r) => r.status)).toEqual(["dead", "pending"]);
  });
});

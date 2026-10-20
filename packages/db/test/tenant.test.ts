import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPglite, createPgliteDb, pgliteMigrationClient } from "../src/clients.js";
import { migrate } from "../src/migrate.js";
import { InvalidTenantError, setActingUser, withoutTenant, withTenant } from "../src/tenant.js";

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

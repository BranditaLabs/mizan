import { copyFileSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { pgliteMigrationClient } from "../src/clients.js";
import { loadMigrations, migrate, MIGRATIONS_DIR } from "../src/migrate.js";

/**
 * E12-2a1 (migrations 0079, 0080): the billing catalogue, subscriptions, one trial per key and
 * coupons. Stores reach trials_used and coupons only through their SECURITY DEFINER functions.
 */
const db = new PGlite();
const T1 = "11111111-1111-1111-1111-111111111111";
const T2 = "22222222-2222-2222-2222-222222222222";
const T3 = "33333333-3333-3333-3333-333333333333";
const T4 = "44444444-4444-4444-4444-444444444444";
const hex = (c: string) => c.repeat(64);

async function inTx<T>(opening: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`BEGIN; ${opening}`);
  try {
    const out = await fn();
    await db.exec("COMMIT;");
    return out;
  } catch (err) {
    await db.exec("ROLLBACK;");
    throw err;
  }
}
const asTenant = <T>(tenant: string, fn: () => Promise<T>) => inTx(`SET LOCAL ROLE mizan_app; SET LOCAL app.tenant_id = '${tenant}';`, fn);
const asRole = <T>(role: string, fn: () => Promise<T>) => inTx(`SET LOCAL ROLE ${role};`, fn);

beforeAll(async () => {
  // Stores that exist before subscriptions launch: two on Free, one staff moved to Scale, one deleted (staff had moved it to Growth).
  const before = mkdtempSync(join(tmpdir(), "mizan-billing-"));
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f < "0079")) copyFileSync(join(MIGRATIONS_DIR, f), join(before, f));
  await migrate(pgliteMigrationClient(db), { dir: before });
  await db.exec(`INSERT INTO tenants (id, name, slug, timezone) VALUES ('${T1}', 'A', 'a', 'Africa/Cairo'), ('${T2}', 'B', 'b', 'Asia/Riyadh');
                 INSERT INTO tenants (id, name, slug, plan) VALUES ('${T3}', 'C', 'c', 'scale');
                 INSERT INTO tenants (id, name, slug, status, plan) VALUES ('${T4}', 'D', 'd', 'deleted', 'growth');`);
  await migrate(pgliteMigrationClient(db));
});

describe("billing schema (E12-2a1)", () => {
  it("migration numbers are unique and in order (docs/16 §11.0: each PR takes the next free number at merge)", () => {
    const versions = loadMigrations().map((m) => Number(m.version));
    expect(new Set(versions).size).toBe(versions.length);
    expect([...versions].sort((a, b) => a - b)).toEqual(versions);
    expect(versions[0]).toBe(1);
  });

  it("backfills one live subscription per store (D18): a fresh Growth trial, staff plans kept comped, deleted stores Free", async () => {
    const subs = await db.query<{ tenant_id: string; plan_code: string; status: string; comp_percent: number; local_end: string }>(
      `SELECT s.tenant_id, s.plan_code, s.status, s.comp_percent, to_char(s.trial_ends_at AT TIME ZONE t.timezone, 'HH24:MI:SS') AS local_end
         FROM subscriptions s JOIN tenants t ON t.id = s.tenant_id ORDER BY s.tenant_id`);
    expect(subs.rows.map(({ local_end: _e, ...r }) => r)).toEqual([
      { tenant_id: T1, plan_code: "growth", status: "trialing", comp_percent: 0 },
      { tenant_id: T2, plan_code: "growth", status: "trialing", comp_percent: 0 },
      { tenant_id: T3, plan_code: "scale", status: "active", comp_percent: 100 },
      { tenant_id: T4, plan_code: "free", status: "active", comp_percent: 0 },
    ]);
    expect(subs.rows[0].local_end).toBe("23:59:59"); // the end of day 7 in the store's own time zone
    const days = await db.query<{ d: number }>(`SELECT ((s.trial_ends_at AT TIME ZONE t.timezone)::date - (now() AT TIME ZONE t.timezone)::date) AS d FROM subscriptions s JOIN tenants t ON t.id = s.tenant_id WHERE s.tenant_id = $1`, [T2]);
    expect(days.rows[0].d).toBe(6); // today is day 1
    const none = await db.query(`SELECT id FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.tenant_id = t.id AND s.status NOT IN ('cancelled','expired'))`);
    expect(none.rows).toEqual([]);
    expect((await db.query<{ plan: string }>(`SELECT plan FROM tenants WHERE id = $1`, [T1])).rows[0].plan).toBe("growth");
    // tenants.plan = the plan the subscription entitles, for every store: the deleted paid one is Free.
    const plans = await db.query<{ id: string; plan: string }>(`SELECT id, plan FROM tenants ORDER BY id`);
    expect(plans.rows).toEqual([{ id: T1, plan: "growth" }, { id: T2, plan: "growth" }, { id: T3, plan: "scale" }, { id: T4, plan: "free" }]);
    expect((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM subscription_events WHERE event = 'backfill'`)).rows[0].n).toBe(4);
  });

  it("keeps one live subscription per store and a trial with its end", async () => {
    await expect(asTenant(T1, () => db.query(`INSERT INTO subscriptions (tenant_id, plan_code, status) VALUES ($1, 'free', 'active')`, [T1]))).rejects.toThrow(/subscriptions_live/);
    await expect(asTenant(T1, () => db.query(`INSERT INTO subscriptions (tenant_id, plan_code, status, ended_at) VALUES ($1, 'growth', 'trialing', now())`, [T1]))).rejects.toThrow(/check/);
    await asTenant(T1, () => db.query(`INSERT INTO subscriptions (tenant_id, plan_code, status, ended_at) VALUES ($1, 'free', 'expired', now())`, [T1])); // history may hold many
  });

  it("isolates subscriptions per store; the history is append-only", async () => {
    const mine = await asTenant(T1, () => db.query<{ tenant_id: string }>(`SELECT DISTINCT tenant_id FROM subscriptions`));
    expect(mine.rows).toEqual([{ tenant_id: T1 }]);
    const ev = await asTenant(T1, () => db.query<{ id: number }>(`SELECT id FROM subscription_events LIMIT 1`));
    await expect(asTenant(T1, () => db.query(`UPDATE subscription_events SET reason = 'x' WHERE id = $1`, [ev.rows[0].id]))).rejects.toThrow(/permission denied/);
    await expect(asTenant(T1, () => db.query(`DELETE FROM subscription_events WHERE id = $1`, [ev.rows[0].id]))).rejects.toThrow(/permission denied/);
    await expect(asTenant(T1, () => db.query(`INSERT INTO subscription_events (tenant_id, subscription_id, event, to_status, to_plan, version, actor_type)
      SELECT $1, id, 'start', 'active', 'free', 1, 'system' FROM subscriptions LIMIT 1`, [T2]))).rejects.toThrow(/row-level security/);
    // A subscription ends (cancelled, expired); it is never deleted, so its history cannot go with it.
    await expect(asTenant(T1, () => db.query(`DELETE FROM subscriptions WHERE tenant_id = $1`, [T1]))).rejects.toThrow(/permission denied/);
    await expect(db.query(`DELETE FROM subscriptions WHERE tenant_id = $1`, [T1])).rejects.toThrow(/subscription_events_subscription_id_fkey/);
    // Overrides are what staff changed by hand: the store reads its own, never writes one.
    await expect(asTenant(T1, () => db.query(`INSERT INTO subscription_overrides (tenant_id, key, value, reason) VALUES ($1, 'limits.users', '50', 'self-service')`, [T1]))).rejects.toThrow(/permission denied/);
    await asRole("mizan_platform", () => db.query(`INSERT INTO subscription_overrides (tenant_id, key, value, reason) VALUES ($1, 'limits.users', '12', 'pilot team')`, [T1]));
    expect((await asTenant(T1, () => db.query(`SELECT key FROM subscription_overrides`))).rows).toEqual([{ key: "limits.users" }]);
    await expect(asTenant(T1, () => db.query(`DELETE FROM subscription_overrides WHERE tenant_id = $1`, [T1]))).rejects.toThrow(/permission denied/);
    await expect(asTenant(T1, () => db.query(`UPDATE subscription_overrides SET value = '99'`))).rejects.toThrow(/permission denied/);
    // The scheduler sees due trials across stores, ids and times only.
    const due = await asRole("mizan_worker", () => db.query(`SELECT id, tenant_id, trial_ends_at FROM subscriptions WHERE status = 'trialing'`));
    expect(due.rows).toHaveLength(2);
    await expect(asRole("mizan_worker", () => db.query(`SELECT plan_code FROM subscriptions`))).rejects.toThrow(/permission denied/);
    // ...and the backfilled paid or trial subscriptions whose trial keys are still to claim: ids and event names only.
    const toClaim = await asRole("mizan_worker", () => db.query(`SELECT e.tenant_id FROM subscription_events e WHERE e.event = 'backfill' AND e.to_plan <> 'free'
      AND NOT EXISTS (SELECT 1 FROM subscription_events m WHERE m.subscription_id = e.subscription_id AND m.event = 'trial_keys_claimed') ORDER BY e.tenant_id`));
    expect(toClaim.rows).toEqual([{ tenant_id: T1 }, { tenant_id: T2 }, { tenant_id: T3 }]);
    await expect(asRole("mizan_worker", () => db.query(`SELECT reason, data FROM subscription_events`))).rejects.toThrow(/permission denied/);
    const staff = await asRole("mizan_platform", () => db.query(`SELECT tenant_id FROM subscriptions`));
    expect(staff.rows.length).toBeGreaterThanOrEqual(4);
  });

  it("tenants.plan has one writer: the subscription service's transaction", async () => {
    await expect(asTenant(T1, () => db.query(`UPDATE tenants SET plan = 'scale' WHERE id = $1`, [T1]))).rejects.toThrow(/written only by the subscription service/);
    await expect(asRole("mizan_platform", () => db.query(`UPDATE tenants SET plan = 'scale' WHERE id = $1`, [T1]))).rejects.toThrow(/permission denied/);
    await asTenant(T1, async () => {
      await db.query(`SELECT set_config('mizan.plan_writer', 'subscription', true)`);
      await db.query(`UPDATE tenants SET plan = 'growth', updated_at = now() WHERE id = $1`, [T1]);
    });
    await asTenant(T1, () => db.query(`UPDATE tenants SET name = 'A2' WHERE id = $1`, [T1])); // other columns are free
    await asRole("mizan_platform", () => db.query(`UPDATE tenants SET status = 'suspended', updated_at = now() WHERE id = $1`, [T2]));
  });

  it("reads the catalogue and settings; prices are minor units, one live row per key", async () => {
    const prices = await asTenant(T1, () => db.query<{ plan_code: string; amount_minor: string }>(
      `SELECT plan_code, amount_minor::text FROM plan_prices WHERE currency = 'EGP' AND billing_interval = 'month' AND kind = 'base' ORDER BY amount_minor`));
    expect(prices.rows).toEqual([{ plan_code: "free", amount_minor: "0" }, { plan_code: "growth", amount_minor: "250000" }, { plan_code: "scale", amount_minor: "650000" }]);
    const s = await asTenant(T1, () => db.query<{ trial_days: number; end_of_trial: string; existing_store_policy: string }>(`SELECT trial_days, end_of_trial, existing_store_policy FROM billing_settings`));
    expect(s.rows[0]).toEqual({ trial_days: 7, end_of_trial: "downgrade_free", existing_store_policy: "trial" });
    await expect(asTenant(T1, () => db.query(`UPDATE billing_settings SET trial_days = 90`))).rejects.toThrow(/permission denied/);
    await expect(asTenant(T1, () => db.query(`INSERT INTO plan_prices (plan_code, kind, currency, billing_interval, amount_minor) VALUES ('growth','base','EGP','month',1)`))).rejects.toThrow(/permission denied/);
    await expect(asRole("mizan_platform", () => db.query(`INSERT INTO plan_prices (plan_code, kind, currency, billing_interval, amount_minor) VALUES ('growth','base','EGP','month',1)`))).rejects.toThrow(/plan_prices_live/);
    await expect(asRole("mizan_platform", () => db.query(`INSERT INTO plan_prices (plan_code, kind, currency, billing_interval, amount_minor) VALUES ('growth','base','EGP','month',-1)`))).rejects.toThrow(/check/);
    await asRole("mizan_platform", () => db.query(`INSERT INTO platform_holidays (country, date, name_ar, name_en) VALUES ('EG', '2027-01-07', 'عيد الميلاد', 'Coptic Christmas')`));
    await expect(asTenant(T1, () => db.query(`SELECT * FROM platform_holidays`))).rejects.toThrow(/permission denied/);
  });
});

describe("claim_trial (one trial per owner, phone and shop domain)", () => {
  const phone = `phone:${hex("a")}`;
  const user1 = `user:${hex("1")}`;
  const user2 = `user:${hex("2")}`;
  const claim = (tenant: string, keys: string[], as = tenant) => asTenant(as, async () => (await db.query<{ ok: boolean }>(`SELECT claim_trial($1::text[], $2::uuid) AS ok`, [keys, tenant])).rows[0].ok);

  it("records the keys once; a second store with any of them is refused, and records none", async () => {
    expect(await claim(T1, [user1, phone])).toBe(true);
    expect(await claim(T1, [user1, phone])).toBe(true); // the same store again: still its own
    expect(await claim(T2, [user2, phone])).toBe(false); // same phone, another owner
    expect(await claim(T2, [user2])).toBe(true); // user2 was not recorded by the refused claim
    expect(await claim(T2, [])).toBe(false);
  });

  it("is the only way in: a store cannot read or write trials_used, nor claim for another store", async () => {
    await expect(asTenant(T1, () => db.query(`SELECT * FROM trials_used`))).rejects.toThrow(/permission denied/);
    await expect(asTenant(T1, () => db.query(`INSERT INTO trials_used (key_hash, kind, tenant_id) VALUES ($1, 'user', $2)`, [`user:${hex("9")}`, T1]))).rejects.toThrow(/permission denied/);
    await expect(asRole("mizan_platform", () => db.query(`SELECT * FROM trials_used`))).rejects.toThrow(/permission denied/);
    await expect(asRole("mizan_worker", () => db.query(`SELECT * FROM trials_used`))).rejects.toThrow(/permission denied/);
    await expect(claim(T2, [`user:${hex("3")}`], T1)).rejects.toThrow(/only for itself/);
    await expect(claim(T1, ["phone:not-a-hash"])).rejects.toThrow(/check/);
  });
});

describe("redeem_coupon", () => {
  const redeem = (tenant: string, code: string) => asTenant(tenant, async () => (await db.query<{ outcome: string; percent_off: number | null; duration_periods: number | null }>(
    `SELECT outcome, percent_off, duration_periods FROM redeem_coupon($1, $2::uuid)`, [code, tenant])).rows[0]);

  it("counts atomically up to the cap, once per store, by invitation when asked", async () => {
    await asRole("mizan_platform", () => db.query(`INSERT INTO coupons (code, percent_off, duration, max_redemptions) VALUES ('TWO', 20, 'once', 2)`));
    expect(await redeem(T1, "two")).toEqual({ outcome: "redeemed", percent_off: 20, duration_periods: null });
    expect((await redeem(T1, "TWO")).outcome).toBe("already_redeemed");
    expect((await redeem(T2, "TWO")).outcome).toBe("redeemed");
    expect((await redeem(T3, "TWO")).outcome).toBe("exhausted");
    expect((await db.query<{ redeemed: number }>(`SELECT redeemed FROM coupons WHERE code = 'TWO'`)).rows[0].redeemed).toBe(2);
    expect((await redeem(T1, "NOPE")).outcome).toBe("not_found");
    expect((await redeem(T1, "LAUNCH50")).outcome).toBe("not_found"); // by invitation: says nothing to others
    await asRole("mizan_platform", () => db.query(`INSERT INTO coupon_invites (coupon_code, tenant_id) VALUES ('LAUNCH50', $1)`, [T1]));
    expect(await redeem(T1, "LAUNCH50")).toEqual({ outcome: "redeemed", percent_off: 100, duration_periods: 3 });
    await asRole("mizan_platform", () => db.query(`INSERT INTO coupons (code, percent_off, duration, valid_until) VALUES ('OLD', 10, 'once', now() - interval '1 day')`));
    expect((await redeem(T1, "OLD")).outcome).toBe("expired");
  });

  it("no store can list or change coupons, nor redeem for another store", async () => {
    await expect(asTenant(T1, () => db.query(`SELECT code FROM coupons`))).rejects.toThrow(/permission denied/);
    await expect(asTenant(T1, () => db.query(`UPDATE coupons SET redeemed = 0`))).rejects.toThrow(/permission denied/);
    await expect(asTenant(T1, () => db.query(`SELECT * FROM coupon_redemptions`))).rejects.toThrow(/permission denied/);
    await expect(asTenant(T1, () => db.query(`SELECT * FROM redeem_coupon('TWO', $1::uuid)`, [T2]))).rejects.toThrow(/only for itself/);
  });
});

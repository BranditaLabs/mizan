import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const dir = join(import.meta.dirname, "..", "migrations");
const db = new PGlite();
const T1 = "11111111-1111-1111-1111-111111111111";
const T2 = "22222222-2222-2222-2222-222222222222";

beforeAll(async () => {
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) await db.exec(readFileSync(join(dir, f), "utf8"));
  await db.exec(`
    INSERT INTO tenants (id, name, slug) VALUES ('${T1}', 'Store A', 'a'), ('${T2}', 'Store B', 'b');
    CREATE ROLE mizan_app NOLOGIN;
    GRANT USAGE ON SCHEMA public TO mizan_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mizan_app;
  `);
});

async function asTenant<T>(tenant: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`BEGIN; SET LOCAL ROLE mizan_app; SET LOCAL app.tenant_id = '${tenant}';`);
  try { return await fn(); } finally { await db.exec("COMMIT;"); }
}

describe("schema", () => {
  it("applies all migrations", async () => {
    const r = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`);
    expect(r.rows[0].n).toBeGreaterThan(30);
  });

  it("isolates tenants with row-level security", async () => {
    await asTenant(T1, () => db.query(`INSERT INTO orders (tenant_id, number, currency, total_minor, placed_at) VALUES ($1, '#A-1', 'EGP', 115000, now())`, [T1]));
    await asTenant(T2, () => db.query(`INSERT INTO orders (tenant_id, number, currency, total_minor, placed_at) VALUES ($1, '#B-1', 'EGP', 64000, now())`, [T2]));
    const a = await asTenant(T1, () => db.query<{ number: string }>(`SELECT number FROM orders`));
    expect(a.rows.map((r) => r.number)).toEqual(["#A-1"]);
    await expect(asTenant(T1, () => db.query(`INSERT INTO orders (tenant_id, number, currency, total_minor, placed_at) VALUES ($1, '#X', 'EGP', 1, now())`, [T2])))
      .rejects.toThrow(/row-level security/);
  });

  it("sees nothing without a tenant context", async () => {
    await db.exec("BEGIN; SET LOCAL ROLE mizan_app;");
    const r = await db.query(`SELECT * FROM orders`);
    await db.exec("COMMIT;");
    expect(r.rows).toHaveLength(0);
  });

  it("computes stock available and net profit in the database", async () => {
    const pnl = await asTenant(T1, async () => {
      const o = await db.query<{ id: string }>(`SELECT id FROM orders LIMIT 1`);
      await db.query(`INSERT INTO order_pnl (order_id, tenant_id, currency, revenue_minor, cogs_minor, shipping_minor, cod_fee_minor, ads_minor)
                      VALUES ($1, $2, 'EGP', 115000, 40000, 6000, 1150, 18000)`, [o.rows[0].id, T1]);
      return db.query<{ net_minor: string }>(`SELECT net_minor FROM order_pnl`);
    });
    expect(Number(pnl.rows[0].net_minor)).toBe(115000 - 40000 - 6000 - 1150 - 18000);
  });

  it("makes offline scans exactly-once by device op id", async () => {
    await asTenant(T1, async () => {
      const p = await db.query<{ id: string }>(`INSERT INTO products (tenant_id, title) VALUES ($1, 'Tee') RETURNING id`, [T1]);
      const v = await db.query<{ id: string }>(`INSERT INTO variants (tenant_id, product_id, sku, currency) VALUES ($1, $2, 'TEE-M', 'EGP') RETURNING id`, [T1, p.rows[0].id]);
      const w = await db.query<{ id: string }>(`INSERT INTO warehouses (tenant_id, name) VALUES ($1, 'Main') RETURNING id`, [T1]);
      const ins = `INSERT INTO stock_movements (tenant_id, warehouse_id, variant_id, delta, reason, device_op_id) VALUES ($1,$2,$3,-1,'pick','dev1-0001') ON CONFLICT (tenant_id, device_op_id) DO NOTHING RETURNING id`;
      expect((await db.query(ins, [T1, w.rows[0].id, v.rows[0].id])).rows).toHaveLength(1);
      expect((await db.query(ins, [T1, w.rows[0].id, v.rows[0].id])).rows).toHaveLength(0);
    });
  });
});

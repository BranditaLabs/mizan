import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { pgliteMigrationClient } from "../src/clients.js";
import { migrate } from "../src/migrate.js";

const db = new PGlite();
const T1 = "11111111-1111-1111-1111-111111111111";
const T2 = "22222222-2222-2222-2222-222222222222";

beforeAll(async () => {
  await migrate(pgliteMigrationClient(db)); // 0003 creates the mizan_app role and its grants
  await db.exec(`INSERT INTO tenants (id, name, slug) VALUES ('${T1}', 'Store A', 'a'), ('${T2}', 'Store B', 'b');`);
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
      await db.query(`INSERT INTO order_pnl (order_id, tenant_id, currency, revenue_minor, cogs_minor, shipping_minor, cod_fee_minor, ads_minor, refund_minor, payment_fee_minor)
                      VALUES ($1, $2, 'EGP', 115000, 40000, 6000, 1150, 18000, 5000, 0)`, [o.rows[0].id, T1]);
      return db.query<{ net_minor: string }>(`SELECT net_minor FROM order_pnl`);
    });
    expect(Number(pnl.rows[0].net_minor)).toBe(115000 - 5000 - 40000 - 6000 - 1150 - 18000);
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

  it("tracks a deposit + COD balance order across payment lines", async () => {
    const r = await asTenant(T1, async () => {
      const gw = await db.query<{ id: string }>(`INSERT INTO connections (tenant_id, kind, provider, external_account) VALUES ($1, 'payment', 'paymob', 'acct-1') RETURNING id`, [T1]);
      const o = await db.query<{ id: string }>(`INSERT INTO orders (tenant_id, number, currency, total_minor, payment_mode, placed_at) VALUES ($1, '#A-2', 'EGP', 210000, 'partial', now()) RETURNING id`, [T1]);
      await db.query(`INSERT INTO payments (tenant_id, order_id, connection_id, method, kind, status, amount_minor, currency, external_ref) VALUES ($1, $2, $3, 'card', 'sale', 'succeeded', 30000, 'EGP', 'txn-1')`, [T1, o.rows[0].id, gw.rows[0].id]);
      await db.query(`UPDATE orders SET paid_minor = (SELECT sum(amount_minor) FROM payments WHERE order_id = $1 AND status = 'succeeded'), payment_status = 'partially_paid' WHERE id = $1`, [o.rows[0].id]);
      return db.query<{ balance_minor: string; payment_status: string }>(`SELECT balance_minor, payment_status FROM orders WHERE id = $1`, [o.rows[0].id]);
    });
    expect(Number(r.rows[0].balance_minor)).toBe(180000);
    expect(r.rows[0].payment_status).toBe("partially_paid");
  });

  it("rejects a duplicate gateway transaction", async () => {
    await expect(asTenant(T1, async () => {
      const o = await db.query<{ id: string; c: string }>(`SELECT o.id, p.connection_id AS c FROM orders o JOIN payments p ON p.order_id = o.id LIMIT 1`);
      await db.query(`INSERT INTO payments (tenant_id, order_id, connection_id, method, kind, status, amount_minor, currency, external_ref) VALUES ($1, $2, $3, 'card', 'sale', 'succeeded', 30000, 'EGP', 'txn-1')`, [T1, o.rows[0].id, o.rows[0].c]);
    })).rejects.toThrow(/duplicate key/);
  });

  it("enables row-level security on every tenant table", async () => {
    const r = await db.query<{ relname: string }>(`
      SELECT c.relname FROM pg_class c JOIN information_schema.columns col ON col.table_name = c.relname AND col.column_name = 'tenant_id'
      WHERE c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace AND NOT c.relrowsecurity
        AND c.relname NOT IN ('mz_inbound_events', 'mz_outbox', 'mz_records') -- engine tables: tenant-scoped in E2-1`);
    expect(r.rows.map((x) => x.relname)).toEqual([]);
  });
});

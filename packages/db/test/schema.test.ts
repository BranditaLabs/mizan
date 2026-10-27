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

async function asRole<T>(role: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`BEGIN; SET LOCAL ROLE ${role};`);
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
      await db.query(`INSERT INTO payments (tenant_id, order_id, connection_id, method, kind, status, source, amount_minor, currency, external_ref) VALUES ($1, $2, $3, 'card', 'sale', 'succeeded', 'gateway', 30000, 'EGP', 'txn-1')`, [T1, o.rows[0].id, gw.rows[0].id]);
      await db.query(`UPDATE orders SET paid_minor = (SELECT sum(amount_minor) FROM payments WHERE order_id = $1 AND status = 'succeeded'), payment_status = 'partially_paid' WHERE id = $1`, [o.rows[0].id]);
      return db.query<{ balance_minor: string; payment_status: string }>(`SELECT balance_minor, payment_status FROM orders WHERE id = $1`, [o.rows[0].id]);
    });
    expect(Number(r.rows[0].balance_minor)).toBe(180000);
    expect(r.rows[0].payment_status).toBe("partially_paid");
  });

  it("rejects a duplicate gateway transaction", async () => {
    await expect(asTenant(T1, async () => {
      const o = await db.query<{ id: string; c: string }>(`SELECT o.id, p.connection_id AS c FROM orders o JOIN payments p ON p.order_id = o.id LIMIT 1`);
      await db.query(`INSERT INTO payments (tenant_id, order_id, connection_id, method, kind, status, source, amount_minor, currency, external_ref) VALUES ($1, $2, $3, 'card', 'sale', 'succeeded', 'gateway', 30000, 'EGP', 'txn-1')`, [T1, o.rows[0].id, o.rows[0].c]);
    })).rejects.toThrow(/duplicate key/);
  });

  it("enables row-level security on every tenant table", async () => {
    const r = await db.query<{ relname: string }>(`
      SELECT c.relname FROM pg_class c JOIN information_schema.columns col ON col.table_name = c.relname AND col.column_name = 'tenant_id'
      WHERE c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace AND NOT c.relrowsecurity
        -- every table with tenant_id, engine tables included (0008)`);
    expect(r.rows.map((x) => x.relname)).toEqual([]);
  });

  it("has an index for every hot query (H-7)", async () => {
    const r = await db.query<{ indexname: string }>(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`);
    const have = new Set(r.rows.map((x) => x.indexname));
    for (const ix of [
      "memberships_user", "order_lines_order", "orders_queue", "mz_outbox_due", "mz_outbox_done",
      "mz_inbound_events_received", "domain_events_due", "domain_events_dispatched", "audit_log_tenant_recent", "idempotency_keys_expiry",
      "products_external", "variants_missing_cost", "product_events_dedupe", "orders_recent", "orders_number", "cost_rules_active", "confirmation_runs_live", "confirmation_steps_due", "order_pnl_day", "order_lines_unlinked", "confirmation_runs_customer", "confirmation_runs_needs_call", "whatsapp_messages_run", "connections_whatsapp_number", "offer_rules_active", "order_offers_order", "order_lines_variant", "ad_spend_day", "orders_duplicates", "orders_customer_recent", "order_reconciliations_recent", "bulk_actions_recent", "bulk_action_items_pending", "variants_barcode", "products_title", "orders_stock_short", "stock_movements_ref", "stock_movements_variant", "ops_operations_device", "mz_outbox_scope_due", "automations_trigger", "automation_runs_recent", "notifications_recent", "payments_ref", "tickets_number", "tickets_queue", "tickets_order", "ticket_events_ticket", "refunds_number", "refunds_queue", "refunds_order", "ticket_events_dedupe", "return_inspections_order", "return_inspections_recent", "shipments_one_live", "shipments_recent", "shipments_review", "shipment_events_shipment", "exchanges_original", "platform_audit_recent", "platform_audit_staff", "platform_store_notes_store", "whatsapp_messages_out",
    ]) expect(have, ix).toContain(ix);
  });

  it("keeps cost rules well formed (E9-1)", async () => {
    const insert = (cols: string, vals: string) => asTenant(T1, () => db.query(`INSERT INTO cost_rules (tenant_id, kind, ${cols}) VALUES ('${T1}', ${vals})`));
    await insert("amount_minor, currency", "'packaging_per_order', 750, 'EGP'");
    await insert("pct, fixed_minor, currency", "'payment_fee_pct', 2.5, 200, 'EGP'");
    await insert("amount_minor, return_minor, currency, scope", `'courier_rate', 6000, 3000, 'EGP', '{"courier":"bosta","zone":"cairo"}'`);
    await expect(insert("pct", "'packaging_per_order', 2")).rejects.toThrow(/cost_rules_shape/);
    await expect(insert("pct", "'cod_fee_pct', 101")).rejects.toThrow(/cost_rules_shape/);
    await expect(insert("amount_minor", "'agent_per_order', 500")).rejects.toThrow(/cost_rules_shape/); // no currency
    await expect(insert("amount_minor, currency, valid_from, valid_to", "'agent_per_order', 500, 'EGP', '2026-10-10', '2026-10-01'")).rejects.toThrow(/cost_rules_dates/);
  });

  it("keeps each store's own exchange rates to itself (E9-1)", async () => {
    await asTenant(T1, () => db.query(`INSERT INTO fx_rate_overrides (tenant_id, day, quote, rate) VALUES ($1, '2026-10-22', 'USD', 0.0205)`, [T1]));
    expect((await asTenant(T2, () => db.query(`SELECT * FROM fx_rate_overrides`))).rows).toEqual([]);
    await expect(asTenant(T2, () => db.query(`INSERT INTO fx_rate_overrides (tenant_id, day, quote, rate) VALUES ($1, '2026-10-22', 'USD', 1)`, [T1])))
      .rejects.toThrow(/row-level security/);
    await expect(db.query(`INSERT INTO fx_rates (day, base, quote, rate, source) VALUES ('2026-10-22', 'USD', 'EGP', 0, 'test')`)).rejects.toThrow(/fx_rates_positive/);
  });

  it("keeps ad spend per store, day, platform and campaign, never negative (E9-3)", async () => {
    const conn = (await asTenant(T1, () => db.query<{ id: string }>(`INSERT INTO connections (tenant_id, kind, provider) VALUES ($1, 'store', 'shopify') RETURNING id`, [T1]))).rows[0]!.id;
    const add = (platform: string, spend: number) => asTenant(T1, () => db.query(`INSERT INTO ad_spend (tenant_id, connection_id, day, platform, campaign_id, spend_minor, currency, source) VALUES ($1, $2, '2026-10-22', $3, '', $4, 'EGP', 'manual')`, [T1, conn, platform, spend]));
    await add("meta", 250000);
    await add("tiktok", 90000); // same day, another platform
    await expect(add("meta", 1)).rejects.toThrow(/duplicate key/);
    await expect(add("google", -1)).rejects.toThrow(/ad_spend_shape/);
    await expect(add("Meta Ads", 1)).rejects.toThrow(/ad_spend_shape/);
    expect((await asTenant(T2, () => db.query(`SELECT * FROM ad_spend`))).rows).toEqual([]);
  });

  it("keeps ledger lines signed by kind and one per reference, with or without a connection (E14-1)", async () => {
    const order = (await asTenant(T1, () => db.query<{ id: string }>(`INSERT INTO orders (tenant_id, external_id, number, currency, total_minor, placed_at) VALUES ($1, 'ledger-1', '#L1', 'EGP', 100000, now()) RETURNING id`, [T1]))).rows[0]!.id;
    const line = (kind: string, amount: number, ref: string | null) => asTenant(T1, () => db.query(
      `INSERT INTO payments (tenant_id, order_id, method, kind, status, source, amount_minor, currency, external_ref) VALUES ($1, $2, 'bank_transfer', $3, 'succeeded', 'manual', $4, 'EGP', $5)`, [T1, order, kind, amount, ref]));
    await line("sale", 40000, "manual:a");
    await line("refund", -1000, "manual:b");
    await expect(line("sale", -1, "manual:c")).rejects.toThrow(/payments_sign/);
    await expect(line("refund", 1, "manual:d")).rejects.toThrow(/payments_sign/);
    await expect(line("sale", 0, "manual:e")).rejects.toThrow(/payments_sign/);
    await expect(line("sale", 40000, "manual:a")).rejects.toThrow(/payments_ref/); // no connection is still one reference
    await line("sale", 100, null);
    await line("sale", 100, null); // lines without a reference are not deduplicated by it
    await expect(asTenant(T1, () => db.query(`INSERT INTO payments (tenant_id, order_id, method, kind, status, source, amount_minor, currency) VALUES ($1, $2, 'card', 'sale', 'succeeded', 'bank', 1, 'EGP')`, [T1, order])))
      .rejects.toThrow(/source_check/);
  });

  it("numbers tickets once per store, with a fixed type and reason (E10-1)", async () => {
    const add = (tenant: string, number: number, extra = "") => asTenant(tenant, () => db.query(`INSERT INTO tickets (tenant_id, number, type${extra ? ", reason" : ""}) VALUES ($1, $2, 'refused'${extra ? `, '${extra}'` : ""}) RETURNING id`, [tenant, number]));
    const t = (await add(T1, 1001, "changed_mind")).rows[0] as { id: string };
    await add(T2, 1001); // each store has its own numbers
    await expect(add(T1, 1001)).rejects.toThrow(/tickets_number/);
    await expect(add(T1, 1002, "too_slow")).rejects.toThrow(/tickets_reason_check/);
    await expect(asTenant(T1, () => db.query(`INSERT INTO tickets (tenant_id, number, type) VALUES ($1, 1003, 'praise')`, [T1]))).rejects.toThrow(/tickets_type_check/);
    await asTenant(T1, () => db.query(`INSERT INTO ticket_events (tenant_id, ticket_id, type, note) VALUES ($1, $2, 'note', 'checked the box')`, [T1, t.id]));
    expect((await asTenant(T2, () => db.query(`SELECT * FROM ticket_events`))).rows).toEqual([]);
    await expect(asTenant(T1, () => db.query(`INSERT INTO ticket_events (tenant_id, ticket_id, type) VALUES ($1, $2, 'deleted')`, [T1, t.id]))).rejects.toThrow(/ticket_events_type_check/);
  });

  it("numbers refunds once per store; a refund step shows once in a ticket's history (E14-4)", async () => {
    const order = (await asTenant(T1, () => db.query<{ id: string }>(`INSERT INTO orders (tenant_id, external_id, number, currency, total_minor, placed_at) VALUES ($1, 'refund-1', '#R1', 'EGP', 100000, now()) RETURNING id`, [T1]))).rows[0]!.id;
    const add = (number: number) => asTenant(T1, () => db.query(`INSERT INTO refunds (tenant_id, order_id, destination, amount_minor, currency, number) VALUES ($1, $2, 'cash', 100, 'EGP', $3)`, [T1, order, number]));
    await add(1001);
    await expect(add(1001)).rejects.toThrow(/refunds_number/);
    await expect(asTenant(T1, () => db.query(`INSERT INTO refunds (tenant_id, order_id, destination, amount_minor, currency, number) VALUES ($1, $2, 'cash', 0, 'EGP', 1002)`, [T1, order]))).rejects.toThrow(/amount_minor_check/);
    const ticket = (await asTenant(T1, () => db.query<{ id: string }>(`INSERT INTO tickets (tenant_id, number, type, order_id) VALUES ($1, 2001, 'refund', $2) RETURNING id`, [T1, order]))).rows[0]!.id;
    const step = () => asTenant(T1, () => db.query(`INSERT INTO ticket_events (tenant_id, ticket_id, type, dedupe_key) VALUES ($1, $2, 'refund', 'r1:approved') ON CONFLICT DO NOTHING`, [T1, ticket]));
    await step();
    await step();
    expect((await asTenant(T1, () => db.query(`SELECT * FROM ticket_events WHERE ticket_id = $1`, [ticket]))).rows).toHaveLength(1);
  });

  it("keeps return inspections per store, a positive count with a known outcome (E10-3)", async () => {
    const order = (await asTenant(T1, () => db.query<{ id: string }>(`INSERT INTO orders (tenant_id, external_id, number, currency, total_minor, placed_at, status) VALUES ($1, 'ret-1', '#RET1', 'EGP', 100000, now(), 'returned') RETURNING id`, [T1]))).rows[0]!.id;
    const line = (await asTenant(T1, () => db.query<{ id: string }>(`INSERT INTO order_lines (tenant_id, order_id, title, quantity, unit_price_minor) VALUES ($1, $2, 'Abaya', 2, 100000) RETURNING id`, [T1, order]))).rows[0]!.id;
    const add = (q: number, outcome: string) => asTenant(T1, () => db.query(`INSERT INTO return_inspections (tenant_id, order_id, order_line_id, quantity, outcome) VALUES ($1, $2, $3, $4, $5)`, [T1, order, line, q, outcome]));
    await add(1, "restock");
    await expect(add(0, "restock")).rejects.toThrow(/quantity_check/);
    await expect(add(1, "lost")).rejects.toThrow(/outcome_check/);
    expect((await asTenant(T2, () => db.query(`SELECT * FROM return_inspections`))).rows).toEqual([]);
  });

  it("freezes usage once per store and month, a month being its first day (E12-3)", async () => {
    const add = (tenant: string, month: string) => asTenant(tenant, () => db.query(`INSERT INTO usage_months (tenant_id, month, orders, whatsapp_messages, ai_offers, stores, users, plan) VALUES ($1, $2, 10, 2, 0, 1, 2, 'free')`, [tenant, month]));
    await add(T1, "2026-09-01");
    await add(T2, "2026-09-01");
    await expect(add(T1, "2026-09-01")).rejects.toThrow(/duplicate key/);
    await expect(add(T1, "2026-09-15")).rejects.toThrow(/usage_months_month_check/);
    expect((await asTenant(T2, () => db.query(`SELECT tenant_id FROM usage_months`))).rows).toEqual([{ tenant_id: T2 }]);
  });

  it("keeps one live courier booking per order; a failed or cancelled one can be booked again (E7-1)", async () => {
    const order = (await asTenant(T1, () => db.query<{ id: string }>(`INSERT INTO orders (tenant_id, external_id, number, currency, total_minor, placed_at, status) VALUES ($1, 'ship-1', '#SHIP1', 'EGP', 100000, now(), 'confirmed') RETURNING id`, [T1]))).rows[0]!.id;
    const courier = (await asTenant(T1, () => db.query<{ id: string }>(`INSERT INTO connections (tenant_id, kind, provider, external_account) VALUES ($1, 'courier', 'bosta', 'bosta-ship') RETURNING id`, [T1]))).rows[0]!.id;
    const book = (booking = "pending") => asTenant(T1, () => db.query<{ id: string }>(`INSERT INTO shipments (tenant_id, order_id, connection_id, provider, currency, booking) VALUES ($1, $2, $3, 'bosta', 'EGP', $4) RETURNING id`, [T1, order, courier, booking]));
    const first = (await book()).rows[0]!.id;
    await expect(book()).rejects.toThrow(/shipments_one_live/);
    await asTenant(T1, () => db.query(`UPDATE shipments SET booking = 'failed', error_code = 'validation' WHERE id = $1`, [first]));
    const second = (await book()).rows[0]!.id;
    await asTenant(T1, () => db.query(`UPDATE shipments SET booking = 'booked', status = 'cancelled' WHERE id = $1`, [second]));
    await book();
    await expect(book("sent")).rejects.toThrow(/booking_check/);
    expect((await asTenant(T2, () => db.query(`SELECT * FROM shipments`))).rows).toEqual([]);
  });

  it("links an exchange's two orders once, per store (E10-2)", async () => {
    const order = async (n: string) => (await asTenant(T1, () => db.query<{ id: string }>(`INSERT INTO orders (tenant_id, number, currency, total_minor, placed_at, status) VALUES ($1, $2, 'EGP', 100000, now(), 'delivered') RETURNING id`, [T1, n]))).rows[0]!.id;
    const original = await order("#EX1");
    const replacement = await order("#EX1-X1");
    const add = (credit: number) => asTenant(T1, () => db.query(`INSERT INTO exchanges (tenant_id, original_order_id, replacement_order_id, reason, items, currency, returned_value_minor, credit_minor) VALUES ($1, $2, $3, 'wrong_size', '[]', 'EGP', 100000, $4)`, [T1, original, replacement, credit]));
    await add(100000);
    await expect(add(100000)).rejects.toThrow(/duplicate key/);
    await expect(asTenant(T1, () => db.query(`UPDATE exchanges SET credit_minor = -1`))).rejects.toThrow(/credit_minor_check/);
    expect((await asTenant(T2, () => db.query(`SELECT * FROM exchanges`))).rows).toEqual([]);
  });

  it("keeps a partial delivery's items and amount due together, and a refusal with its time (E10-4)", async () => {
    const id = (await asTenant(T1, () => db.query<{ id: string }>(`INSERT INTO orders (tenant_id, number, currency, total_minor, placed_at, status) VALUES ($1, '#PD1', 'EGP', 100000, now(), 'shipped') RETURNING id`, [T1]))).rows[0]!.id;
    await expect(asTenant(T1, () => db.query(`UPDATE orders SET partial_items = '[]' WHERE id = $1`, [id]))).rejects.toThrow(/orders_partial_whole/);
    await asTenant(T1, () => db.query(`UPDATE orders SET partial_items = '[]', partial_due_minor = 50000 WHERE id = $1`, [id]));
    expect(Number((await asTenant(T1, () => db.query<{ balance_minor: string }>(`SELECT balance_minor FROM orders WHERE id = $1`, [id]))).rows[0]!.balance_minor)).toBe(50000); // owed: what they kept
    await expect(asTenant(T1, () => db.query(`UPDATE orders SET refusal_reason = 'price' WHERE id = $1`, [id]))).rejects.toThrow(/orders_refusal_whole/);
    await expect(asTenant(T1, () => db.query(`UPDATE orders SET partial_due_minor = -1 WHERE id = $1`, [id]))).rejects.toThrow(/partial_due_minor_check/);
  });

  it("keeps staff to the back office: the app never sees them; the back office reads store metadata, never orders or secrets (A-1)", async () => {
    const user = (await db.query<{ id: string }>(`INSERT INTO users (firebase_uid, email) VALUES ('fb-staff-1', 'ops@mizan.test') RETURNING id`)).rows[0]!.id;
    await asRole("mizan_platform", () => db.query(`INSERT INTO platform_staff (user_id, role) VALUES ($1, 'super_admin')`, [user]));
    await expect(asRole("mizan_app", () => db.query(`SELECT * FROM platform_staff`))).rejects.toThrow(/permission denied/);
    await expect(asRole("mizan_app", () => db.query(`SELECT * FROM platform_audit`))).rejects.toThrow(/permission denied/);
    await asRole("mizan_platform", () => db.query(`INSERT INTO platform_audit (user_id, action, outcome) VALUES ($1, 'GET /v1/platform/me', 'ok')`, [user]));
    await expect(asRole("mizan_platform", () => db.query(`UPDATE platform_audit SET action = 'x'`))).rejects.toThrow(/permission denied/);
    await expect(asRole("mizan_platform", () => db.query(`DELETE FROM platform_audit`))).rejects.toThrow(/permission denied/);
    await expect(asRole("mizan_platform", () => db.query(`INSERT INTO platform_staff (user_id, role) VALUES ($1, 'god')`, [user]))).rejects.toThrow(/role_check|duplicate/);
    // Across stores: tenants and their connections, read-only; never orders or secrets.
    const stores = await asRole("mizan_platform", () => db.query<{ id: string }>(`SELECT id FROM tenants WHERE id IN ($1, $2) ORDER BY id`, [T1, T2]));
    expect(stores.rows.map((r) => r.id)).toEqual([T1, T2]);
    await asRole("mizan_platform", () => db.query(`SELECT id FROM connections`));
    await expect(asRole("mizan_platform", () => db.query(`SELECT * FROM orders`))).rejects.toThrow(/permission denied/);
    await expect(asRole("mizan_platform", () => db.query(`SELECT * FROM secrets`))).rejects.toThrow(/permission denied/);
    await expect(asRole("mizan_platform", () => db.query(`UPDATE connections SET status = 'disconnected'`))).rejects.toThrow(/permission denied/);
  });

  it("lets the back office change a store's plan and status, write to its audit log as staff, and keep notes the store cannot read (A-2)", async () => {
    const t = (await db.query<{ id: string }>(`INSERT INTO tenants (name, slug) VALUES ('Staff Store', 'staff-store-a2') RETURNING id`)).rows[0]!.id;
    await asRole("mizan_platform", () => db.query(`UPDATE tenants SET status = 'suspended', plan = 'growth', updated_at = now() WHERE id = $1`, [t]));
    expect((await db.query<{ status: string; plan: string }>(`SELECT status, plan FROM tenants WHERE id = $1`, [t])).rows[0]).toEqual({ status: "suspended", plan: "growth" });
    await expect(asRole("mizan_platform", () => db.query(`UPDATE tenants SET name = 'x' WHERE id = $1`, [t]))).rejects.toThrow(/permission denied/);
    await asRole("mizan_platform", () => db.query(`INSERT INTO audit_log (tenant_id, actor_type, action) VALUES ($1, 'mizan_staff', 'store.suspended')`, [t]));
    await expect(asRole("mizan_platform", () => db.query(`INSERT INTO audit_log (tenant_id, actor_type, action) VALUES ($1, 'user', 'member.removed')`, [t]))).rejects.toThrow(/row-level security/);
    await expect(asRole("mizan_platform", () => db.query(`SELECT * FROM audit_log`))).rejects.toThrow(/permission denied/);
    const seen = await asTenant(t, () => db.query<{ actor_type: string }>(`SELECT actor_type FROM audit_log WHERE action = 'store.suspended'`));
    expect(seen.rows.map((r) => r.actor_type)).toEqual(["mizan_staff"]); // the store sees what Mizan did
    await asRole("mizan_platform", () => db.query(`INSERT INTO platform_store_notes (store_id, body) VALUES ($1, 'called the owner')`, [t]));
    await expect(asRole("mizan_platform", () => db.query(`INSERT INTO platform_store_notes (store_id, body) VALUES ($1, '')`, [t]))).rejects.toThrow(/body_check/);
    await expect(asRole("mizan_app", () => db.query(`SELECT * FROM platform_store_notes`))).rejects.toThrow(/permission denied/);
  });

  it("engine order records hold no personal data (E2-8, migration 0025 shape)", async () => {
    const sql = (await import("node:fs")).readFileSync(new URL("../migrations/0025_engine_records_without_pii.sql", import.meta.url), "utf8");
    const order = { externalId: "gid://shopify/Order/9", total: { amount: "1150.00", currency: "EGP" }, customer: { name: "Mona Adel", phone: "+201001234821", email: "mona@example.com" },
      shippingAddress: { name: "Mona", phone: "01001234821", line1: "12 Abbas El Akkad St", line2: "Floor 3", city: "Nasr City", province: "Cairo", zip: "11765", countryCode: "EG" } };
    await db.query(`INSERT INTO mz_records (tenant_id, type, key, value, updated_at) VALUES ($1, 'order', 'o9', $2, 0), ($1, 'order', 'o10', $3, 0), ($1, 'cursor', 'c', '{"since": 1}', 0)`,
      [T1, JSON.stringify({ order, trackingNumber: "TN1" }), JSON.stringify({ order: { ...order, shippingAddress: undefined } })]);
    await db.exec(sql);
    const rows = await db.query<{ key: string; value: { order: Record<string, unknown>; trackingNumber?: string } }>(`SELECT key, value FROM mz_records WHERE type = 'order' ORDER BY key`);
    expect(JSON.stringify(rows.rows)).not.toMatch(/Mona|4821|Abbas|Floor|11765|mona@/);
    const o9 = rows.rows.find((r) => r.key === "o9")!.value;
    expect(o9).toMatchObject({ trackingNumber: "TN1", order: { total: { amount: "1150.00" }, customer: { name: "" }, shippingAddress: { line1: "", city: "Nasr City", province: "Cairo", countryCode: "EG" } } });
    expect(rows.rows.find((r) => r.key === "o10")!.value.order.shippingAddress).toBeNull();
  });

  it("a duplicate points at another order and has a state, or neither (E5-3)", async () => {
    const [a, b] = (await asTenant(T1, () => db.query<{ id: string }>(`INSERT INTO orders (tenant_id, number, currency, total_minor, placed_at) VALUES ($1, '#D-1', 'EGP', 1, now()), ($1, '#D-2', 'EGP', 1, now()) RETURNING id`, [T1]))).rows;
    await asTenant(T1, () => db.query(`UPDATE orders SET duplicate_of = $1, duplicate_status = 'suspected' WHERE id = $2`, [a!.id, b!.id]));
    await expect(asTenant(T1, () => db.query(`UPDATE orders SET duplicate_status = NULL WHERE id = $1`, [b!.id]))).rejects.toThrow(/orders_duplicate_shape/);
    await expect(asTenant(T1, () => db.query(`UPDATE orders SET duplicate_of = id, duplicate_status = 'kept' WHERE id = $1`, [a!.id]))).rejects.toThrow(/orders_duplicate_shape/);
    await expect(asTenant(T1, () => db.query(`UPDATE orders SET duplicate_status = 'maybe' WHERE id = $1`, [b!.id]))).rejects.toThrow(/duplicate_status_check/);
  });

  it("records one reconciliation per store and day, with the gap computed (E5-8)", async () => {
    const conn = (await asTenant(T1, () => db.query<{ id: string }>(`INSERT INTO connections (tenant_id, kind, provider, external_account) VALUES ($1, 'store', 'shopify', 'rec.myshopify.com') RETURNING id`, [T1]))).rows[0]!.id;
    const add = (store: number, mizan: number) => asTenant(T1, () => db.query<{ gap: number }>(`INSERT INTO order_reconciliations (tenant_id, connection_id, day, store_orders, mizan_orders) VALUES ($1, $2, '2026-10-23', $3, $4) RETURNING gap`, [T1, conn, store, mizan]));
    expect((await add(12, 11)).rows[0]!.gap).toBe(1);
    await expect(add(12, 12)).rejects.toThrow(/duplicate key/);
    expect((await asTenant(T2, () => db.query(`SELECT * FROM order_reconciliations`))).rows).toEqual([]);
  });

  it("keeps bulk actions consistent and per store (E5-4)", async () => {
    const order = (await asTenant(T1, () => db.query<{ id: string }>(`SELECT id FROM orders LIMIT 1`))).rows[0]!.id;
    const bulk = (await asTenant(T1, () => db.query<{ id: string }>(`INSERT INTO bulk_actions (tenant_id, action, total) VALUES ($1, 'cancel', 1) RETURNING id`, [T1]))).rows[0]!.id;
    await asTenant(T1, () => db.query(`INSERT INTO bulk_action_items (bulk_id, tenant_id, order_id) VALUES ($1, $2, $3)`, [bulk, T1, order]));
    await expect(asTenant(T1, () => db.query(`INSERT INTO bulk_action_items (bulk_id, tenant_id, order_id) VALUES ($1, $2, $3)`, [bulk, T1, order]))).rejects.toThrow(/duplicate key/);
    await expect(asTenant(T1, () => db.query(`UPDATE bulk_actions SET done = 2 WHERE id = $1`, [bulk]))).rejects.toThrow(/bulk_actions_counts/);
    await expect(asTenant(T1, () => db.query(`INSERT INTO bulk_actions (tenant_id, action, total) VALUES ($1, 'ship', 1)`, [T1]))).rejects.toThrow(/check/);
    expect((await asTenant(T2, () => db.query(`SELECT * FROM bulk_action_items`))).rows).toEqual([]);
  });

  it("keeps a barcode on one variant per store (E8-1)", async () => {
    const product = (t: string) => asTenant(t, () => db.query<{ id: string }>(`INSERT INTO products (tenant_id, title) VALUES ($1, 'Abaya') RETURNING id`, [t])).then((r) => r.rows[0]!.id);
    const variant = (t: string, p: string, sku: string, barcode: string | null) =>
      asTenant(t, () => db.query(`INSERT INTO variants (tenant_id, product_id, sku, barcode, currency) VALUES ($1, $2, $3, $4, 'EGP')`, [t, p, sku, barcode]));
    const [p1, p2] = [await product(T1), await product(T2)];
    await variant(T1, p1, "BC-1", "6221234567890");
    await expect(variant(T1, p1, "BC-2", "6221234567890")).rejects.toThrow(/variants_barcode/);
    await variant(T1, p1, "BC-3", null);
    await variant(T1, p1, "BC-4", null); // many variants without a barcode
    await variant(T2, p2, "BC-1", "6221234567890"); // another store may use the same code
  });

  it("records what an order holds, and movements in the order they were written (E8-2)", async () => {
    await expect(asTenant(T1, () => db.query(`UPDATE orders SET stock_status = 'maybe' WHERE tenant_id = $1`, [T1]))).rejects.toThrow(/check/);
    await asTenant(T1, () => db.query(`UPDATE orders SET stock_status = 'short' WHERE tenant_id = $1`, [T1]));
    const wh = (await asTenant(T1, () => db.query<{ id: string }>(`INSERT INTO warehouses (tenant_id, name) VALUES ($1, 'Main') RETURNING id`, [T1]))).rows[0]!.id;
    const p = (await asTenant(T1, () => db.query<{ id: string }>(`INSERT INTO products (tenant_id, title) VALUES ($1, 'Tote') RETURNING id`, [T1]))).rows[0]!.id;
    const v = (await asTenant(T1, () => db.query<{ id: string }>(`INSERT INTO variants (tenant_id, product_id, sku, currency) VALUES ($1, $2, 'TOTE-1', 'EGP') RETURNING id`, [T1, p]))).rows[0]!.id;
    const seq = (await asTenant(T1, () => db.query<{ seq: string }>(`INSERT INTO stock_movements (tenant_id, warehouse_id, variant_id, delta, reason, detail) VALUES ($1, $2, $3, 5, 'adjust', 'count'), ($1, $2, $3, 2, 'reserve', NULL) RETURNING seq`, [T1, wh, v]))).rows;
    expect(Number(seq[1]!.seq)).toBeGreaterThan(Number(seq[0]!.seq));
    expect((await asTenant(T2, () => db.query(`SELECT * FROM stock_movements`))).rows).toEqual([]);
  });

  it("keeps each ops-app operation once per store (E8-3)", async () => {
    const op = (t: string, id: string, status = "applied") => asTenant(t, () => db.query(`INSERT INTO ops_operations (tenant_id, op_id, device_id, type, status, client_at) VALUES ($1, $2, 'pixel-1', 'stock.count', $3, now())`, [t, id, status]));
    await op(T1, "op-0000001");
    await expect(op(T1, "op-0000001")).rejects.toThrow(/duplicate key/);
    await op(T2, "op-0000001"); // another store's phone may use the same id
    await expect(op(T1, "short")).rejects.toThrow(/check/);
    await expect(op(T1, "op-0000002", "maybe")).rejects.toThrow(/check/);
    expect((await asTenant(T2, () => db.query(`SELECT op_id FROM ops_operations`))).rows).toEqual([{ op_id: "op-0000001" }]);
  });

  it("keeps engine rows apart per store of a tenant (E2-7)", async () => {
    const rec = (scope: string) => asTenant(T1, () => db.query(`INSERT INTO mz_records (tenant_id, scope, type, key, value, updated_at) VALUES ($1, $2, 'cursor', 'orders', '{}', 1)`, [T1, scope]));
    await rec("store-a");
    await rec("store-b"); // the same key in another store
    await expect(rec("store-a")).rejects.toThrow(/duplicate key/);
    const job = (scope: string) => asTenant(T1, () => db.query(`INSERT INTO mz_outbox (id, tenant_id, scope, kind, connection, payload, idempotency_key, status, next_attempt_at, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, 'shopify.ingestOrder', 'shopify', '{}', 'shopify:order:1', 'pending', 1, 1, 1)`, [T1, scope]));
    await job("store-a");
    await job("store-b");
    await expect(job("store-b")).rejects.toThrow(/duplicate key/);
  });

  it("keeps team notifications per store, addressed to roles, once per key (E11-1)", async () => {
    const note = (t: string, key: string | null, roles = "{owner}") => asTenant(t, () => db.query(`INSERT INTO notifications (tenant_id, roles, text, source, dedupe_key) VALUES ($1, $2, 'Big order #1042', 'automation:x', $3)`, [t, roles, key]));
    await note(T1, "run-1:0");
    await expect(note(T1, "run-1:0")).rejects.toThrow(/duplicate key/);
    await note(T1, null);
    await note(T1, null); // no key: no dedupe
    await expect(note(T1, "run-2:0", "{}")).rejects.toThrow(/check/);
    expect((await asTenant(T2, () => db.query(`SELECT * FROM notifications`))).rows).toEqual([]);
  });

  it("keeps one live confirmation run per order and unique step keys (E6-7)", async () => {
    const order = (await asTenant(T1, () => db.query<{ id: string }>(`SELECT id FROM orders LIMIT 1`))).rows[0]!.id;
    const run = (await asTenant(T1, () => db.query<{ id: string }>(`INSERT INTO confirmation_runs (tenant_id, order_id, link_expires_at) VALUES ($1, $2, now() + interval '3 days') RETURNING id`, [T1, order]))).rows[0]!.id;
    await expect(asTenant(T1, () => db.query(`INSERT INTO confirmation_runs (tenant_id, order_id, link_expires_at) VALUES ($1, $2, now())`, [T1, order]))).rejects.toThrow(/confirmation_runs_live/);
    const step = (key: string) => asTenant(T1, () => db.query(`INSERT INTO confirmation_steps (tenant_id, run_id, idx, channel, kind, run_at, idempotency_key) VALUES ($1, $2, 0, 'sms', 'send', now(), $3)`, [T1, run, key]));
    await step("r:0:send");
    await expect(step("r:0:send")).rejects.toThrow(/duplicate key/);
    await expect(asTenant(T1, () => db.query(`INSERT INTO confirmations (tenant_id, order_id, channel, outcome, run_id) VALUES ($1, $2, 'link', 'confirmed', $3)`, [T1, order, run]))).resolves.toBeDefined();
    expect((await asTenant(T2, () => db.query(`SELECT * FROM confirmation_runs`))).rows).toEqual([]);
    // The worker sees ids and times only.
    await db.exec("BEGIN; SET LOCAL ROLE mizan_worker;");
    try {
      const due = await db.query<{ tenant_id: string }>(`SELECT tenant_id FROM confirmation_steps WHERE status = 'pending'`);
      expect(due.rows.map((r) => r.tenant_id)).toEqual([T1]);
      await expect(db.query(`SELECT idempotency_key FROM confirmation_steps`)).rejects.toThrow(/permission denied/);
    } finally { await db.exec("ROLLBACK;"); }
  });
});

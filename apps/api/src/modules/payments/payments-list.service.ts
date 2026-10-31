import { Inject, Injectable } from "@nestjs/common";
import { sql, type RawBuilder, type SqlBool } from "kysely";
import { fromMinor, type PaymentMode, type PaymentStatus } from "@mizan/shared";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { Database } from "../../platform/db/database.js";
import { ProblemError } from "../../platform/http/problem.js";
import { PAYMENT_VIEWS, type ListPaymentsQuery, type PaymentPage, type PaymentView } from "./payments.dto.js";

/** Orders still before delivery: their cash is still to collect. */
const OPEN = sql.join(["new", "pending_confirmation", "confirmed", "shipped"].map((s) => sql.lit(s)));
/** Money in, net of voids (docs/12 §3). */
const MONEY_IN = sql.join(["sale", "capture", "cod_collection", "void"].map((s) => sql.lit(s)));

/**
 * Each view as a condition on `orders o` (E14-6; docs/modules/M15 main screen):
 * - unpaid: waiting for money before it can ship (any method but cash on delivery), not cancelled;
 * - paid: fully paid;
 * - cod_due: cash the courier still has to collect, before delivery;
 * - refunds: money given back; disputes: a chargeback is open or was booked.
 */
export const VIEW_SQL: Record<PaymentView, RawBuilder<SqlBool>> = {
  all: sql<SqlBool>`true`,
  unpaid: sql<SqlBool>`o.payment_status in ('unpaid','failed') and o.payment_mode <> 'cod' and o.status not in ('cancelled','returned')`,
  paid: sql<SqlBool>`o.payment_status = 'paid'`,
  cod_due: sql<SqlBool>`o.cod_minor > 0 and o.status in (${OPEN})`,
  refunds: sql<SqlBool>`o.refunded_minor > 0`,
  disputes: sql<SqlBool>`(o.payment_status = 'disputed' or exists (select 1 from payments c where c.order_id = o.id and c.kind = 'chargeback' and c.status = 'succeeded'))`,
};

const encode = (at: Date, id: string) => Buffer.from(`${at.toISOString()}|${id}`).toString("base64url");
function decode(cursor: string) {
  const [at, id] = Buffer.from(cursor, "base64url").toString().split("|");
  const d = new Date(at ?? "");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id) || Number.isNaN(d.getTime())) throw new ProblemError(422, "validation_failed", "cursor is not valid", [{ path: "cursor", code: "invalid" }]);
  return { at: d, id };
}

/**
 * The payments screen (M15, E14-6): orders by where their money stands, with what was paid,
 * refunded and is still owed, the methods in their ledger, counts per view and the view's sums
 * per currency; and the payment mix for the home screen. Reads only.
 */
@Injectable()
export class PaymentsListService {
  constructor(@Inject(Database) private readonly db: Database) {}

  async list(auth: AuthContext, q: ListPaymentsQuery): Promise<PaymentPage> {
    const after = q.cursor ? decode(q.cursor) : null;
    return this.db.tenant(auth.tenant!.id, async (trx) => {
      const filters = (extra: RawBuilder<SqlBool>[] = []) => {
        const parts = [...extra];
        if (q.mode) parts.push(sql<SqlBool>`o.payment_mode = ${q.mode}`);
        if (q.q) { const n = q.q.replace(/^#/, ""); parts.push(sql<SqlBool>`o.number in (${n}, ${`#${n}`})`); }
        return parts.length ? sql<SqlBool>`${sql.join(parts, sql` and `)}` : sql<SqlBool>`true`;
      };
      const where = filters([VIEW_SQL[q.view]]);
      let rows = trx.selectFrom("orders as o")
        .select(["o.id", "o.number", "o.status", "o.placed_at", "o.payment_mode", "o.payment_status", "o.currency", "o.total_minor", "o.paid_minor", "o.refunded_minor", "o.balance_minor", "o.cod_minor",
          sql<string[]>`(select coalesce(array_agg(distinct p.method order by p.method), '{}') from payments p where p.order_id = o.id and p.status = 'succeeded')`.as("methods")])
        .where(where).orderBy("o.placed_at", "desc").orderBy("o.id", "desc").limit(q.limit + 1);
      if (after) rows = rows.where((eb) => eb.or([eb("o.placed_at", "<", after.at), eb.and([eb("o.placed_at", "=", after.at), eb("o.id", "<", after.id)])]));
      const found = await rows.execute();

      const base = filters();
      const countSql = sql.join(PAYMENT_VIEWS.map((v) => sql`count(*) filter (where ${VIEW_SQL[v]}) as ${sql.ref(v)}`));
      const counts = (await sql<Record<PaymentView, string>>`select ${countSql} from orders o where ${base}`.execute(trx)).rows[0]!;
      const totals = await trx.selectFrom("orders as o").where(where).groupBy("o.currency").orderBy("o.currency")
        .select(["o.currency", sql<string>`sum(o.total_minor)`.as("total"), sql<string>`sum(o.paid_minor)`.as("paid"), sql<string>`sum(o.refunded_minor)`.as("refunded"),
          sql<string>`sum(o.balance_minor)`.as("balance"), sql<string>`sum(o.cod_minor)`.as("cod")]).execute();

      const page = found.slice(0, q.limit);
      const last = page.at(-1);
      const m = (minor: bigint | string | number | null, currency: string) => fromMinor(BigInt(minor ?? 0), currency.trim());
      return {
        data: page.map((o) => ({
          order: { id: o.id, number: o.number, status: o.status, placedAt: o.placed_at.toISOString() },
          mode: o.payment_mode as PaymentMode, status: o.payment_status as PaymentStatus, methods: o.methods,
          total: m(o.total_minor, o.currency), paid: m(o.paid_minor, o.currency), refunded: m(o.refunded_minor, o.currency),
          balance: m(String(o.balance_minor ?? 0), o.currency), cod: m(o.cod_minor, o.currency),
        })),
        counts: Object.fromEntries(PAYMENT_VIEWS.map((v) => [v, Number(counts[v])])) as PaymentPage["counts"],
        totals: totals.map((t) => ({
          currency: t.currency.trim(), total: m(t.total, t.currency), paid: m(t.paid, t.currency), refunded: m(t.refunded, t.currency), balance: m(t.balance, t.currency), cod: m(t.cod, t.currency),
        })),
        nextCursor: found.length > q.limit && last ? encode(last.placed_at, last.id) : null,
      };
    });
  }

  /** The period's payment mix: orders by payment mode (share of orders), money in by method. */
  async mix(auth: AuthContext, days: number) {
    return this.db.tenant(auth.tenant!.id, async (trx) => {
      const since = sql<Date>`now() - make_interval(days => ${days})`;
      const modes = await trx.selectFrom("orders").select(["payment_mode", sql<string>`count(*)`.as("n")])
        .where("placed_at", ">=", since).where("status", "!=", "cancelled").groupBy("payment_mode").orderBy(sql`count(*)`, "desc").orderBy("payment_mode").execute();
      const total = modes.reduce((a, r) => a + Number(r.n), 0);
      const received = await trx.selectFrom("payments").select(["method", "currency", sql<string>`sum(amount_minor)`.as("amount")])
        .where("occurred_at", ">=", since).where("status", "=", "succeeded").where(sql<SqlBool>`kind in (${MONEY_IN})`)
        .groupBy(["method", "currency"]).having(sql<SqlBool>`sum(amount_minor) <> 0`).orderBy(sql`sum(amount_minor)`, "desc").execute();
      return {
        days, orders: total,
        modes: modes.map((r) => ({ mode: r.payment_mode as PaymentMode, orders: Number(r.n), pct: total ? Math.round((Number(r.n) / total) * 1000) / 10 : 0 })),
        received: received.map((r) => ({ method: r.method, amount: fromMinor(BigInt(r.amount), r.currency.trim()) })),
      };
    });
  }
}

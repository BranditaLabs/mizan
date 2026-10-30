import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";
import type { DB } from "@mizan/db";
import { fromMinor, toMinor, type EventActor } from "@mizan/shared";
import { auditActor, AuditService } from "../../platform/audit/audit.service.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { Database } from "../../platform/db/database.js";
import { EventsService } from "../../platform/events/events.service.js";
import { ProblemError } from "../../platform/http/problem.js";
import { check, statusOf, totals, type LedgerKind, type LedgerLine, type LedgerSource, type LedgerStatus, type LedgerTotals } from "./ledger.js";
import type { Ledger, RecordPayment } from "./payments.dto.js";

type Trx = Transaction<DB>;
type Row = { kind: string; status: string; amount_minor: bigint | string; source: string };

export interface PostLine {
  kind: LedgerKind;
  method: string;
  amountMinor: bigint;
  currency: string;
  source: Exclude<LedgerSource, "store">;
  /** The provider's transaction id, or the team's entry key: one line per reference. */
  externalRef: string;
  connectionId?: string | null;
  status?: LedgerStatus;
  parentId?: string | null;
  note?: string | null;
  /** The provider's actual fee on this line (a chargeback fee): a cost in profit. */
  feeMinor?: bigint;
  recordedBy?: string | null;
  occurredAt?: Date;
  /** Added to the line's event (a refund's id and number). */
  eventData?: Record<string, unknown>;
}

/** What the order row holds about money once its ledger is summed. */
export interface OrderMoney { paid_minor: bigint; refunded_minor: bigint; payment_status: string; cod_minor: bigint }

const asLine = (r: Row): LedgerLine => ({ kind: r.kind as LedgerKind, status: r.status as LedgerStatus, amountMinor: BigInt(r.amount_minor), source: r.source as LedgerSource });
const MONEY_IN = new Set(["sale", "capture", "cod_collection"]);

/**
 * The payment ledger (M15, E14-1; docs/12 §3). Every money movement on an order is one signed
 * line in `payments`; the order's paid_minor, refunded_minor and payment status are the ledger's
 * sums, written in the same transaction as the line, with the order row locked.
 *
 * Two writers: the store's running totals (`syncStore`, from the order projector: the store is
 * the record, each change becomes a line for the difference) and everything else (`post`: a
 * gateway transaction, the courier's cash, the team's entry), checked so the ledger never holds
 * more than the order is worth or gives back more than it holds. While an order has only store
 * lines its status and cash to collect are the store's; once it has its own, they follow the sums.
 */
@Injectable()
export class LedgerService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EventsService) private readonly events: EventsService,
  ) {}

  /**
   * The store's totals for an order as lines: a change in received or refunded becomes one line
   * for the difference from the store's own earlier lines, keyed by the new total so a replay
   * never double-counts. Returns the order's money with the team's and gateways' lines included.
   */
  async syncStore(
    trx: Trx, tenantId: string, orderId: string, connectionId: string | null,
    store: { externalId: string; currency: string; at: Date | string; method(firstMoneyIn: boolean): string },
    after: OrderMoney & { total_minor: bigint; payment_mode: string; previous_status: string },
  ): Promise<OrderMoney> {
    const rows = await this.rows(trx, orderId);
    const storeRows = rows.filter((r) => r.source === "store");
    const own = totals(storeRows.map(asLine));
    // The count makes a total that comes back (paid, voided, paid again) a new line, not a replay.
    const n = storeRows.length;
    const lines: Array<{ kind: LedgerKind; method: string; amount: bigint; ref: string }> = [];
    if (after.paid_minor !== own.paid) {
      const method = store.method(own.paid === 0n);
      const kind = after.paid_minor < own.paid ? "void" : method === "cod" ? "cod_collection" : "sale";
      lines.push({ kind, method, amount: after.paid_minor - own.paid, ref: `${store.externalId}:in:${after.paid_minor}#${n}` });
    }
    if (after.refunded_minor > own.refunded) {
      lines.push({ kind: "refund", method: store.method(false), amount: -(after.refunded_minor - own.refunded), ref: `${store.externalId}:refund:${after.refunded_minor}#${n}` });
    }
    for (const l of lines) {
      const inserted = await trx.insertInto("payments").values({
        tenant_id: tenantId, order_id: orderId, connection_id: connectionId, method: l.method, kind: l.kind, status: "succeeded", source: "store",
        amount_minor: l.amount, currency: store.currency, external_ref: l.ref, occurred_at: store.at,
      }).onConflict((oc) => oc.doNothing()).returning(["id", "kind", "status", "amount_minor", "source"]).executeTakeFirst();
      if (inserted) rows.push(inserted);
      if (inserted && l.kind === "refund") await this.storeRefunded(trx, tenantId, orderId, inserted.id, -l.amount);
    }
    return money(rows.map(asLine), after);
  }

  /** One line from a gateway, the courier or the team: checked, written once per reference, then the order follows. */
  async post(trx: Trx, tenantId: string, orderId: string, line: PostLine, actor: EventActor): Promise<{ id: string; duplicate: boolean; totals: LedgerTotals }> {
    const o = await trx.selectFrom("orders").select(["id", "number", "currency", "total_minor", "partial_due_minor", "payment_mode", "payment_status", "paid_minor", "refunded_minor", "cod_minor"])
      .where("id", "=", orderId).forUpdate().executeTakeFirst();
    if (!o) throw new ProblemError(404, "not_found", "order not found");
    const known = line.externalRef
      ? await trx.selectFrom("payments").select("id").where("kind", "=", line.kind).where("external_ref", "=", line.externalRef)
        .where((eb) => (line.connectionId ? eb("connection_id", "=", line.connectionId) : eb("connection_id", "is", null))).executeTakeFirst()
      : undefined;
    const rows = await this.rows(trx, orderId);
    if (known) return { id: known.id, duplicate: true, totals: totals(rows.map(asLine)) };
    if (line.currency !== o.currency) throw new ProblemError(422, "currency_mismatch", `this order is in ${o.currency}`);
    const status = line.status ?? "succeeded";
    const before = totals(rows.map(asLine));
    // After a partial delivery (E10-4) the customer owes for what they kept, not the whole order.
    const due = BigInt(o.partial_due_minor ?? o.total_minor);
    const rejected = status === "succeeded" ? check(before, due, { kind: line.kind, amountMinor: line.amountMinor }) : null;
    if (rejected) throw new ProblemError(409, rejected, REJECTIONS[rejected]);

    const row = await trx.insertInto("payments").values({
      tenant_id: tenantId, order_id: orderId, connection_id: line.connectionId ?? null, method: line.method, kind: line.kind, status, source: line.source,
      amount_minor: line.amountMinor, currency: line.currency, external_ref: line.externalRef, parent_id: line.parentId ?? null,
      note: line.note ?? null, recorded_by: line.recordedBy ?? null, occurred_at: line.occurredAt ?? new Date(),
      ...(line.feeMinor !== undefined ? { fee_minor: line.feeMinor, fee_is_actual: true } : {}),
    }).returning(["id", "kind", "status", "amount_minor", "source"]).executeTakeFirstOrThrow();
    const all = [...rows, row].map(asLine);
    const next = money(all, {
      paid_minor: BigInt(o.paid_minor), refunded_minor: BigInt(o.refunded_minor), payment_status: o.payment_status, cod_minor: BigInt(o.cod_minor),
      total_minor: due, payment_mode: o.payment_mode, previous_status: o.payment_status,
    });
    const changed = next.paid_minor !== BigInt(o.paid_minor) || next.refunded_minor !== BigInt(o.refunded_minor) || next.payment_status !== o.payment_status || next.cod_minor !== BigInt(o.cod_minor);
    if (changed) await trx.updateTable("orders").set({ ...next, updated_at: new Date() }).where("id", "=", orderId).execute();

    const entity = { type: "order", id: orderId };
    const data = { number: o.number, paymentId: row.id, kind: line.kind, method: line.method, source: line.source, amountMinor: String(line.amountMinor), currency: o.currency, ...line.eventData };
    if (status === "failed") await this.events.emit(trx, { type: "payment.failed", tenantId, entity, actor, data });
    else if (status === "succeeded") {
      const type = MONEY_IN.has(line.kind) ? "payment.received" : line.kind === "refund" ? "refund.completed" : line.kind === "chargeback" ? "dispute.opened" : null;
      if (type) await this.events.emit(trx, { type, tenantId, entity, actor, data });
    }
    if (changed) {
      await trx.insertInto("order_events").values({
        tenant_id: tenantId, order_id: orderId, type: "payment_changed", actor_type: actor.type === "user" ? "user" : "system", actor_id: actor.type === "user" ? actor.id ?? null : null,
        data: JSON.stringify({ from: o.payment_status, to: next.payment_status, source: line.source }),
      }).execute();
      await this.events.emit(trx, {
        type: "order.payment_changed", tenantId, entity, actor,
        data: { number: o.number, mode: o.payment_mode, from: o.payment_status, to: next.payment_status, paidMinor: String(next.paid_minor), refundedMinor: String(next.refunded_minor), currency: o.currency },
      });
    }
    return { id: row.id, duplicate: false, totals: totals(all) };
  }

  /** The order's ledger for the payments panel (finance, owner, admin, ops manager). */
  async get(auth: AuthContext, orderId: string): Promise<Ledger> {
    return this.db.tenant(auth.tenant!.id, (trx) => this.read(trx, orderId, auth));
  }

  /** The team records money they received or gave back outside any gateway (a transfer, InstaPay, cash). Audited. */
  async record(auth: AuthContext, orderId: string, body: RecordPayment): Promise<Ledger> {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const o = await trx.selectFrom("orders").select(["currency"]).where("id", "=", orderId).executeTakeFirst();
      if (!o) throw new ProblemError(404, "not_found", "order not found");
      let minor: bigint;
      try {
        minor = toMinor({ amount: body.amount, currency: o.currency });
      } catch {
        throw new ProblemError(422, "validation_failed", "amount has more decimals than the currency", [{ path: "amount", code: "invalid", message: body.amount }]);
      }
      const kind: LedgerKind = body.type === "received" ? "sale" : "refund";
      const r = await this.post(trx, tenantId, orderId, {
        kind, method: body.method, amountMinor: kind === "refund" ? -minor : minor, currency: o.currency, source: "manual",
        externalRef: `manual:${randomUUID()}`, note: body.note?.trim() || null, recordedBy: auth.user.id, occurredAt: body.occurredAt ? new Date(body.occurredAt) : undefined,
      }, { type: "user", id: auth.user.id });
      await this.audit.record(trx, {
        action: "payment.recorded", tenantId, entity: { type: "order", id: orderId },
        after: { paymentId: r.id, kind, method: body.method, amountMinor: String(minor), currency: o.currency }, ...auditActor(auth),
      });
      return this.read(trx, orderId, auth);
    });
  }

  /**
   * The store refunded money (E14-4): approved refunds to the original method on this order,
   * oldest first, are completed by it while it covers them. Money back through the store's own
   * checkout is done in the store, so Mizan never books it twice.
   */
  private async storeRefunded(trx: Trx, tenantId: string, orderId: string, paymentId: string, amount: bigint) {
    const open = await trx.selectFrom("refunds").select(["id", "number", "amount_minor", "currency", "ticket_id"])
      .where("order_id", "=", orderId).where("status", "=", "approved").where("destination", "=", "original_method")
      .orderBy("approved_at").orderBy("number").forUpdate().execute();
    let left = amount;
    for (const r of open) {
      const a = BigInt(r.amount_minor);
      if (a > left) break;
      left -= a;
      await trx.updateTable("refunds").set({ status: "completed", completed_at: new Date(), refund_payment_id: paymentId, updated_at: new Date() }).where("id", "=", r.id).execute();
      await this.events.emit(trx, {
        type: "refund.completed", tenantId, entity: { type: "order", id: orderId }, actor: { type: "engine" },
        data: { refundId: r.id, refund: `R-${r.number}`, paymentId, amountMinor: String(-a), currency: r.currency, source: "store", ticketId: r.ticket_id },
      });
    }
  }

  private rows(trx: Trx, orderId: string): Promise<Row[]> {
    return trx.selectFrom("payments").select(["kind", "status", "amount_minor", "source"]).where("order_id", "=", orderId).execute();
  }

  private async read(trx: Trx, orderId: string, auth: AuthContext): Promise<Ledger> {
    const o = await trx.selectFrom("orders").select(["id", "currency", "total_minor", "paid_minor", "refunded_minor", "balance_minor", "payment_status"]).where("id", "=", orderId).executeTakeFirst();
    if (!o) throw new ProblemError(404, "not_found", "order not found");
    const lines = await trx.selectFrom("payments as p").leftJoin("users as u", "u.id", "p.recorded_by")
      .select(["p.id", "p.kind", "p.method", "p.status", "p.source", "p.amount_minor", "p.currency", "p.fee_minor", "p.fee_is_actual", "p.note", "p.occurred_at", "p.created_at", "u.display_name"])
      .where("p.order_id", "=", orderId).orderBy("p.occurred_at", "desc").orderBy("p.created_at", "desc").execute();
    const t = totals(lines.map((l) => asLine(l)));
    const m = (minor: bigint | string | number, currency = o.currency) => fromMinor(BigInt(minor), currency);
    return {
      orderId: o.id, currency: o.currency, status: o.payment_status,
      total: m(o.total_minor), paid: m(o.paid_minor), refunded: m(o.refunded_minor), chargedBack: m(t.chargedBack), net: m(t.net), balance: m(String(o.balance_minor ?? 0)),
      canRecord: ["owner", "admin", "finance"].includes(auth.tenant!.role),
      lines: lines.map((l) => ({
        id: l.id, kind: l.kind, method: l.method, status: l.status, source: l.source as LedgerSource, amount: m(l.amount_minor, l.currency),
        fee: l.fee_minor === null ? null : m(l.fee_minor, l.currency), feeIsActual: l.fee_is_actual, note: l.note, recordedBy: l.display_name ?? null,
        occurredAt: l.occurred_at.toISOString(),
      })),
    };
  }
}

/**
 * The order's money from all its lines. Only store lines → the store's status and cash to collect
 * stand; with lines of its own the ledger decides, and a COD or deposit order collects what is
 * still owed.
 */
export function money(lines: LedgerLine[], o: OrderMoney & { total_minor: bigint; payment_mode: string; previous_status: string }): OrderMoney {
  const t = totals(lines);
  const own = lines.some((l) => l.source && l.source !== "store");
  if (!own) return { paid_minor: t.paid, refunded_minor: t.refunded, payment_status: o.payment_status, cod_minor: o.cod_minor };
  const owed = o.total_minor > t.paid ? o.total_minor - t.paid : 0n;
  return {
    paid_minor: t.paid, refunded_minor: t.refunded, payment_status: statusOf(t, o.total_minor, o.previous_status),
    cod_minor: o.payment_mode === "cod" || o.payment_mode === "partial" ? owed : o.cod_minor,
  };
}

const REJECTIONS: Record<string, string> = {
  zero_amount: "the amount must not be zero",
  wrong_sign: "money in is positive, money out negative",
  over_payment: "this is more than the order still owes",
  over_refund: "this is more than the order holds",
  over_void: "this is more than the order holds",
  over_chargeback: "this is more than the order holds",
  over_reversal: "this is more than was charged back",
};

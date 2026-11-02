import { Inject, Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import type { DB } from "@mizan/db";
import { fromMinor, toMinor, type EventActor } from "@mizan/shared";
import { auditActor, AuditService } from "../../platform/audit/audit.service.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { Database } from "../../platform/db/database.js";
import { EventsService } from "../../platform/events/events.service.js";
import { ProblemError } from "../../platform/http/problem.js";
import { totals, type LedgerKind, type LedgerStatus } from "./ledger.js";
import { LedgerService } from "./ledger.service.js";
import type { CompleteRefund, ListRefundsQuery, NewRefund, Refund } from "./payments.dto.js";
import { APPROVERS, destinationsFor, ledgerMethodFor, needsApproval, type RefundDestination, type RefundStatus } from "./refunds.rules.js";
import { refundSettings, type RefundSettings } from "./refunds.settings.js";

type Trx = Transaction<DB>;
const label = (n: number) => `R-${n}`;
const OPEN = ["requested", "approved"] as const;
const MONEY_IN = new Set(["sale", "capture", "cod_collection"]);

/**
 * Refunds (M15, E14-4; docs/12 §5.3). A refund is asked for on an order (and optionally its
 * ticket), never for more than the order holds less the refunds still open. Under the store's
 * threshold it is approved at once; over it, owner, admin or finance approve, never whoever asked
 * (unless the owner). Then the money goes back:
 * - store credit: credited to the customer and completed on approval;
 * - the original method on a store order: done in the store, completed when the store reports it
 *   (the ledger's store sync), so it is never booked twice;
 * - a transfer, cash, or the original method on Mizan's own orders: completed when the team says
 *   it is sent, with its reference.
 * Each completed refund is a refund line in the payments ledger. Every step is audited and raises
 * an event (refund.created, refund.approved, refund.rejected, refund.completed).
 */
@Injectable()
export class RefundsService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(LedgerService) private readonly ledger: LedgerService,
  ) {}

  async options(auth: AuthContext, orderId: string) {
    return this.db.tenant(auth.tenant!.id, async (trx) => {
      const f = await this.facts(trx, orderId);
      const s = await this.settings(trx, auth.tenant!.id);
      return {
        refundable: fromMinor(f.refundable, f.currency), destinations: destinationsFor(f),
        approveOver: fromMinor(toMinor({ amount: s.approveOver, currency: s.baseCurrency }), s.baseCurrency),
      };
    });
  }

  async request(auth: AuthContext, orderId: string, body: NewRefund): Promise<Refund> {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const f = await this.facts(trx, orderId, true);
      let amount: bigint;
      try {
        amount = toMinor({ amount: body.amount, currency: f.currency });
      } catch {
        throw new ProblemError(422, "validation_failed", "amount has more decimals than the currency", [{ path: "amount", code: "invalid", message: body.amount }]);
      }
      if (!destinationsFor(f).includes(body.destination)) {
        throw new ProblemError(422, "destination_unavailable", body.destination === "original_method" ? "this order's money did not come in online" : "this order has no customer to credit", [{ path: "destination", code: "unavailable", message: body.destination }]);
      }
      if (amount > f.refundable) throw new ProblemError(409, "over_refund", `at most ${fromMinor(f.refundable, f.currency).amount} can go back on this order`);
      if (body.ticketId) {
        const tk = await trx.selectFrom("tickets").select("order_id").where("id", "=", body.ticketId).executeTakeFirst();
        if (!tk || tk.order_id !== orderId) throw new ProblemError(422, "validation_failed", "the ticket is not on this order", [{ path: "ticketId", code: "not_found", message: body.ticketId }]);
      }
      await sql`select pg_advisory_xact_lock(hashtext(${`refunds:${tenantId}`}))`.execute(trx);
      const next = await trx.selectFrom("refunds").select(sql<number>`coalesce(max(number), 1000) + 1`.as("n")).executeTakeFirstOrThrow();
      const r = await trx.insertInto("refunds").values({
        tenant_id: tenantId, order_id: orderId, ticket_id: body.ticketId ?? null, destination: body.destination, amount_minor: amount, currency: f.currency,
        reason: body.reason ?? null, status: "requested", requested_by: auth.user.id, number: Number(next.n),
      }).returning(["id", "number"]).executeTakeFirstOrThrow();
      const actor: EventActor = { type: "user", id: auth.user.id };
      const s = await this.settings(trx, tenantId);
      const approval = needsApproval({ amountMinor: amount, currency: f.currency }, { approveOverMinor: toMinor({ amount: s.approveOver, currency: s.baseCurrency }), baseCurrency: s.baseCurrency });
      const data = { refundId: r.id, refund: label(r.number), number: f.number, destination: body.destination, amountMinor: String(amount), currency: f.currency, ticketId: body.ticketId ?? null, needsApproval: approval };
      await this.events.emit(trx, { type: "refund.created", tenantId, entity: { type: "order", id: orderId }, actor, data });
      await this.audit.record(trx, { action: "refund.requested", tenantId, entity: { type: "order", id: orderId }, after: data, ...auditActor(auth) });
      if (!approval) await this.approveIn(trx, auth, r.id, true);
      return this.read(trx, auth, r.id);
    });
  }

  async approve(auth: AuthContext, id: string): Promise<Refund> {
    return this.db.tenant(auth.tenant!.id, async (trx) => {
      await this.approveIn(trx, auth, id, false);
      return this.read(trx, auth, id);
    });
  }

  async reject(auth: AuthContext, id: string, reason: string): Promise<Refund> {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const r = await this.lock(trx, id);
      if (r.status !== "requested") throw new ProblemError(409, "refund_not_pending", "only a refund waiting for approval can be rejected");
      await trx.updateTable("refunds").set({ status: "rejected", rejected_at: new Date(), rejection_reason: reason, approved_by: auth.user.id, updated_at: new Date() }).where("id", "=", id).execute();
      const data = { refundId: id, refund: label(r.number), amountMinor: String(r.amount_minor), currency: r.currency, ticketId: r.ticket_id };
      await this.events.emit(trx, { type: "refund.rejected", tenantId, entity: { type: "order", id: r.order_id }, actor: { type: "user", id: auth.user.id }, data });
      await this.audit.record(trx, { action: "refund.rejected", tenantId, entity: { type: "order", id: r.order_id }, after: data, ...auditActor(auth) });
      return this.read(trx, auth, id);
    });
  }

  async complete(auth: AuthContext, id: string, body: CompleteRefund): Promise<Refund> {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const r = await this.lock(trx, id);
      if (r.status !== "approved") throw new ProblemError(409, "refund_not_approved", "only an approved refund can be completed");
      const f = await this.facts(trx, r.order_id, true, id);
      if (r.destination === "original_method" && f.storeOrder) {
        throw new ProblemError(409, "completes_from_store", "refund it in the store; it completes here when the store reports it");
      }
      await this.completeIn(trx, auth, r, f.methods, { type: "user", id: auth.user.id }, body.reference ?? null, body.note ?? null);
      await this.audit.record(trx, { action: "refund.completed", tenantId, entity: { type: "order", id: r.order_id }, after: { refundId: id, refund: label(r.number), reference: body.reference ?? null }, ...auditActor(auth) });
      return this.read(trx, auth, id);
    });
  }

  async list(auth: AuthContext, q: ListRefundsQuery) {
    return this.db.tenant(auth.tenant!.id, async (trx) => {
      let rows = this.select(trx).orderBy("r.created_at", "desc").orderBy("r.number", "desc").limit(q.limit);
      if (q.status === "open") rows = rows.where("r.status", "in", [...OPEN]);
      else if (q.status !== "all") rows = rows.where("r.status", "=", q.status);
      if (q.orderId) rows = rows.where("r.order_id", "=", q.orderId);
      const found = await rows.execute();
      const s = await this.settings(trx, auth.tenant!.id);
      let counts = trx.selectFrom("refunds").select(["status", sql<string>`count(*)`.as("n")]).groupBy("status");
      if (q.orderId) counts = counts.where("order_id", "=", q.orderId);
      const by = new Map((await counts.execute()).map((c) => [c.status, Number(c.n)]));
      return {
        data: found.map((r) => this.shape(r, auth, s)),
        counts: { requested: by.get("requested") ?? 0, approved: by.get("approved") ?? 0, completed: by.get("completed") ?? 0, rejected: by.get("rejected") ?? 0 },
      };
    });
  }

  async getSettings(auth: AuthContext): Promise<RefundSettings> {
    return this.db.tenant(auth.tenant!.id, async (trx) => {
      const t = await trx.selectFrom("tenants").select("settings").where("id", "=", auth.tenant!.id).executeTakeFirstOrThrow();
      return refundSettings(t.settings);
    });
  }

  async putSettings(auth: AuthContext, body: RefundSettings): Promise<RefundSettings> {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const t = await trx.selectFrom("tenants").select(["settings", "base_currency"]).where("id", "=", tenantId).forUpdate().executeTakeFirstOrThrow();
      try {
        toMinor({ amount: body.approveOver, currency: t.base_currency.trim() });
      } catch {
        throw new ProblemError(422, "validation_failed", "too many decimals for the store's currency", [{ path: "approveOver", code: "invalid", message: body.approveOver }]);
      }
      const before = refundSettings(t.settings);
      await trx.updateTable("tenants").set({ settings: JSON.stringify({ ...(t.settings as object), refunds: body }) }).where("id", "=", tenantId).execute();
      await this.audit.record(trx, { action: "refunds.settings_updated", tenantId, entity: { type: "tenant", id: tenantId }, before, after: body, ...auditActor(auth) });
      return body;
    });
  }

  /** Approve inside a transaction: by the rules, or at once under the threshold (`auto`). */
  private async approveIn(trx: Trx, auth: AuthContext, id: string, auto: boolean) {
    const tenantId = auth.tenant!.id;
    const role = auth.tenant!.role;
    const r = await this.lock(trx, id);
    if (r.status !== "requested") throw new ProblemError(409, "refund_not_pending", "only a refund waiting for approval can be approved");
    if (!auto) {
      if (!APPROVERS.has(role)) throw new ProblemError(403, "forbidden", "owner, admin or finance approve refunds");
      if (r.requested_by === auth.user.id && role !== "owner") throw new ProblemError(403, "own_refund", "someone other than who asked approves a refund");
    }
    // What the order holds may have changed since it was asked for.
    const f = await this.facts(trx, r.order_id, true, id);
    if (BigInt(r.amount_minor) > f.refundable) throw new ProblemError(409, "over_refund", `at most ${fromMinor(f.refundable, f.currency).amount} can go back on this order now`);
    const now = new Date();
    await trx.updateTable("refunds").set({ status: "approved", approved_by: auth.user.id, approved_at: now, updated_at: now }).where("id", "=", id).execute();
    const actor: EventActor = { type: "user", id: auth.user.id };
    const data = { refundId: id, refund: label(r.number), destination: r.destination, amountMinor: String(r.amount_minor), currency: r.currency, ticketId: r.ticket_id, auto };
    await this.events.emit(trx, { type: "refund.approved", tenantId, entity: { type: "order", id: r.order_id }, actor, data });
    await this.audit.record(trx, { action: "refund.approved", tenantId, entity: { type: "order", id: r.order_id }, after: data, ...auditActor(auth) });
    if (r.destination === "store_credit") await this.completeIn(trx, auth, { ...r, status: "approved" }, f.methods, actor, null, null);
  }

  private async completeIn(trx: Trx, auth: AuthContext, r: Locked, methods: string[], actor: EventActor, reference: string | null, note: string | null) {
    const tenantId = auth.tenant!.id;
    const amount = BigInt(r.amount_minor);
    if (r.destination === "store_credit") {
      const o = await trx.selectFrom("orders").select("customer_id").where("id", "=", r.order_id).executeTakeFirstOrThrow();
      if (!o.customer_id) throw new ProblemError(409, "destination_unavailable", "this order has no customer to credit");
      await trx.insertInto("store_credit_ledger").values({ tenant_id: tenantId, customer_id: o.customer_id, delta_minor: amount, currency: r.currency, reason: "refund", ref_id: r.id }).execute();
    }
    const line = await this.ledger.post(trx, tenantId, r.order_id, {
      kind: "refund", method: ledgerMethodFor(r.destination as RefundDestination, methods), amountMinor: -amount, currency: r.currency, source: "manual",
      externalRef: `refund:${r.id}`, note: reference ?? note, recordedBy: auth.user.id,
      eventData: { refundId: r.id, refund: label(r.number), destination: r.destination, ticketId: r.ticket_id },
    }, actor);
    const now = new Date();
    await trx.updateTable("refunds").set({ status: "completed", completed_at: now, refund_payment_id: line.id, external_ref: reference, note, updated_at: now }).where("id", "=", r.id).execute();
  }

  private async lock(trx: Trx, id: string): Promise<Locked> {
    const r = await trx.selectFrom("refunds").select(["id", "number", "order_id", "ticket_id", "destination", "amount_minor", "currency", "status", "requested_by"])
      .where("id", "=", id).forUpdate().executeTakeFirst();
    if (!r) throw new ProblemError(404, "not_found", "refund not found");
    return r;
  }

  /** The order, the methods its money came in by, and what can still go back (held less open refunds). */
  private async facts(trx: Trx, orderId: string, lock = false, except?: string) {
    let q = trx.selectFrom("orders").select(["id", "number", "currency", "customer_id", "connection_id"]).where("id", "=", orderId);
    if (lock) q = q.forUpdate();
    const o = await q.executeTakeFirst();
    if (!o) throw new ProblemError(404, "not_found", "order not found");
    const lines = await trx.selectFrom("payments").select(["kind", "status", "amount_minor", "method"]).where("order_id", "=", orderId).execute();
    const held = totals(lines.map((l) => ({ kind: l.kind as LedgerKind, status: l.status as LedgerStatus, amountMinor: BigInt(l.amount_minor) }))).net;
    let open = trx.selectFrom("refunds").select(sql<string>`coalesce(sum(amount_minor), 0)`.as("n")).where("order_id", "=", orderId).where("status", "in", [...OPEN]);
    if (except) open = open.where("id", "!=", except);
    const pending = BigInt((await open.executeTakeFirstOrThrow()).n);
    const refundable = held - pending > 0n ? held - pending : 0n;
    const methods = [...new Set(lines.filter((l) => l.status === "succeeded" && MONEY_IN.has(l.kind)).map((l) => l.method))];
    return { number: o.number, currency: o.currency.trim(), hasCustomer: o.customer_id !== null, storeOrder: o.connection_id !== null, methods, refundable };
  }

  private async settings(trx: Trx, tenantId: string) {
    const t = await trx.selectFrom("tenants").select(["settings", "base_currency"]).where("id", "=", tenantId).executeTakeFirstOrThrow();
    return { ...refundSettings(t.settings), baseCurrency: t.base_currency.trim() };
  }

  private select(trx: Trx) {
    return trx.selectFrom("refunds as r").innerJoin("orders as o", "o.id", "r.order_id").leftJoin("tickets as t", "t.id", "r.ticket_id")
      .leftJoin("users as q", "q.id", "r.requested_by").leftJoin("users as a", "a.id", "r.approved_by")
      .select(["r.id", "r.number", "r.order_id", "o.number as order_number", "o.connection_id", "r.ticket_id", "t.number as ticket_number", "r.amount_minor", "r.currency", "r.destination", "r.status",
        "r.reason", "r.requested_by", "q.display_name as requester_name", "q.email as requester_email", "r.approved_by", "a.display_name as approver_name", "a.email as approver_email",
        "r.rejection_reason", "r.external_ref", "r.created_at", "r.approved_at", "r.completed_at"]);
  }

  private shape(r: Row, auth: AuthContext, s: RefundSettings & { baseCurrency: string }): Refund {
    const role = auth.tenant!.role;
    const approver = APPROVERS.has(role);
    const fromStore = r.destination === "original_method" && r.connection_id !== null;
    const currency = r.currency.trim();
    return {
      id: r.id, number: label(r.number), order: { id: r.order_id, number: r.order_number },
      ticket: r.ticket_id && r.ticket_number !== null ? { id: r.ticket_id, number: `T-${r.ticket_number}` } : null,
      amount: fromMinor(BigInt(r.amount_minor), currency), destination: r.destination as RefundDestination, status: r.status as RefundStatus, reason: r.reason,
      requestedBy: r.requested_by ? { id: r.requested_by, name: r.requester_name ?? r.requester_email } : null,
      approvedBy: r.approved_by ? { id: r.approved_by, name: r.approver_name ?? r.approver_email } : null,
      rejectionReason: r.rejection_reason, reference: r.external_ref,
      needsApproval: needsApproval({ amountMinor: BigInt(r.amount_minor), currency }, { approveOverMinor: toMinor({ amount: s.approveOver, currency: s.baseCurrency }), baseCurrency: s.baseCurrency }),
      can: {
        approve: approver && r.status === "requested" && (r.requested_by !== auth.user.id || role === "owner"),
        reject: approver && r.status === "requested",
        complete: approver && r.status === "approved" && r.destination !== "store_credit" && !fromStore,
      },
      completesFromStore: fromStore,
      createdAt: r.created_at.toISOString(), approvedAt: r.approved_at?.toISOString() ?? null, completedAt: r.completed_at?.toISOString() ?? null,
    };
  }

  private async read(trx: Trx, auth: AuthContext, id: string): Promise<Refund> {
    const r = await this.select(trx).where("r.id", "=", id).executeTakeFirst();
    if (!r) throw new ProblemError(404, "not_found", "refund not found");
    return this.shape(r, auth, await this.settings(trx, auth.tenant!.id));
  }
}

type Locked = { id: string; number: number; order_id: string; ticket_id: string | null; destination: string; amount_minor: bigint | string; currency: string; status: string; requested_by: string | null };
type Row = Awaited<ReturnType<ReturnType<RefundsService["select"]>["executeTakeFirstOrThrow"]>>;

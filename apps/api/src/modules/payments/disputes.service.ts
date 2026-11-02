import { Inject, Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import type { DB } from "@mizan/db";
import { fromMinor, toMinor, type EventActor } from "@mizan/shared";
import { auditActor, AuditService } from "../../platform/audit/audit.service.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { Database } from "../../platform/db/database.js";
import { EventsService } from "../../platform/events/events.service.js";
import { ProblemError } from "../../platform/http/problem.js";
import { PiiCipher } from "../../platform/pii/pii-cipher.js";
import { DISPUTE_STATUSES, OPEN_DISPUTE, type CloseDispute, type Dispute, type DisputeStatus, type EvidencePack, type ListDisputesQuery, type NewDispute } from "./disputes.dto.js";
import { LedgerService } from "./ledger.service.js";

type Trx = Transaction<DB>;
const DAY = 86_400_000;
const iso = (d: Date | null) => d?.toISOString() ?? null;
const notFound = () => new ProblemError(404, "not_found", "dispute not found");

/**
 * Disputes (M15, E14-5; docs/12 §5.4). A chargeback is recorded on an order (D-1001…, one per
 * gateway case): its amount leaves the ledger as a chargeback line carrying the gateway's fee, so
 * the order shows disputed and profit counts the loss. The team builds the evidence pack from the
 * order, its delivery, the WhatsApp exchange and the payments, submits it to the gateway, and
 * closes the dispute: won puts the amount back (a reversal line; the fee stays a cost), lost or
 * accepted leaves it out. Every step is audited and raises an event.
 */
@Injectable()
export class DisputesService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(PiiCipher) private readonly cipher: PiiCipher,
  ) {}

  async open(auth: AuthContext, orderId: string, body: NewDispute, now = new Date()): Promise<Dispute> {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const o = await trx.selectFrom("orders").select(["id", "number", "currency"]).where("id", "=", orderId).executeTakeFirst();
      if (!o) throw new ProblemError(404, "not_found", "order not found");
      if (body.externalRef) {
        const known = await trx.selectFrom("disputes").select(["id", "order_id"]).where("external_ref", "=", body.externalRef).executeTakeFirst();
        if (known && known.order_id !== orderId) throw new ProblemError(409, "case_on_other_order", "this case is already recorded on another order");
        if (known) return this.view(trx, known.id, now);
      }
      const minor = (v: string, path: string) => {
        try { return toMinor({ amount: v, currency: o.currency }); } catch {
          throw new ProblemError(422, "validation_failed", `too many decimals for ${o.currency}`, [{ path, code: "invalid", message: v }]);
        }
      };
      const amount = minor(body.amount, "amount");
      const fee = body.fee ? minor(body.fee, "fee") : 0n;
      // The chargeback comes off the method the customer paid with.
      const paidBy = await trx.selectFrom("payments").select("method").where("order_id", "=", orderId).where("kind", "in", ["sale", "capture"])
        .where("status", "=", "succeeded").orderBy("occurred_at", "desc").limit(1).executeTakeFirst();
      const method = paidBy?.method ?? "card";
      const next = await trx.selectFrom("disputes").select(sql<number>`coalesce(max(number), 1000) + 1`.as("n")).executeTakeFirstOrThrow();
      const number = Number(next.n);
      const d = await trx.insertInto("disputes").values({
        tenant_id: tenantId, order_id: orderId, number, amount_minor: amount, fee_minor: fee, currency: o.currency, reason_code: body.reason,
        status: "open", respond_by: body.respondBy ? new Date(body.respondBy) : null, external_ref: body.externalRef ?? null,
        note: body.note || null, source: "manual", opened_by: auth.user.id,
      }).returning("id").executeTakeFirstOrThrow();
      const actor: EventActor = { type: "user", id: auth.user.id };
      const line = await this.ledger.post(trx, tenantId, orderId, {
        kind: "chargeback", method, amountMinor: -amount, feeMinor: fee, currency: o.currency, source: "manual", externalRef: `dispute:${d.id}`,
        recordedBy: auth.user.id, note: `D-${number}`, occurredAt: now,
        eventData: { disputeId: d.id, dispute: `D-${number}`, reason: body.reason, feeMinor: String(fee), respondBy: body.respondBy ?? null },
      }, actor);
      await trx.updateTable("disputes").set({ payment_id: line.id }).where("id", "=", d.id).execute();
      await this.audit.record(trx, {
        action: "dispute.opened", tenantId, entity: { type: "order", id: orderId },
        after: { disputeId: d.id, dispute: `D-${number}`, amountMinor: String(amount), feeMinor: String(fee), currency: o.currency, reason: body.reason }, ...auditActor(auth),
      });
      return this.view(trx, d.id, now);
    });
  }

  async list(auth: AuthContext, q: ListDisputesQuery, now = new Date()) {
    return this.db.tenant(auth.tenant!.id, async (trx) => {
      let query = this.base(trx);
      if (q.orderId) query = query.where("d.order_id", "=", q.orderId);
      if (q.status === "open") query = query.where("d.status", "in", [...OPEN_DISPUTE]);
      if (q.status === "closed") query = query.where("d.status", "not in", [...OPEN_DISPUTE]);
      const rows = await query.orderBy(sql`d.respond_by asc nulls last`).orderBy("d.number", "desc").limit(200).execute();
      let counted = trx.selectFrom("disputes").select(["status", sql<number>`count(*)::int`.as("n")]).groupBy("status");
      if (q.orderId) counted = counted.where("order_id", "=", q.orderId);
      const counts = Object.fromEntries(DISPUTE_STATUSES.map((s) => [s, 0])) as Record<DisputeStatus, number>;
      for (const c of await counted.execute()) counts[c.status as DisputeStatus] = Number(c.n);
      return { data: rows.map((r) => this.shape(r, now)), counts };
    });
  }

  async get(auth: AuthContext, id: string, now = new Date()): Promise<Dispute> {
    return this.db.tenant(auth.tenant!.id, (trx) => this.view(trx, id, now));
  }

  async submitEvidence(auth: AuthContext, id: string, note: string | undefined, now = new Date()): Promise<Dispute> {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const d = await this.lock(trx, id);
      if (d.status !== "open") throw new ProblemError(409, "not_open", "evidence goes in while the dispute is open");
      await trx.updateTable("disputes").set({
        status: "evidence_submitted", evidence_submitted_at: now, updated_at: now,
        evidence: JSON.stringify({ note: note || null, submittedBy: auth.user.id, sections: ["order", "customer", "payments", "shipments", "confirmation", "messages"] }),
      }).where("id", "=", id).execute();
      await this.events.emit(trx, {
        type: "dispute.evidence_submitted", tenantId, entity: { type: "order", id: d.order_id }, actor: { type: "user", id: auth.user.id },
        data: { disputeId: id, dispute: `D-${d.number}` },
      });
      await this.audit.record(trx, { action: "dispute.evidence_submitted", tenantId, entity: { type: "order", id: d.order_id }, after: { disputeId: id, dispute: `D-${d.number}` }, ...auditActor(auth) });
      return this.view(trx, id, now);
    });
  }

  async close(auth: AuthContext, id: string, body: CloseDispute, now = new Date()): Promise<Dispute> {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const d = await this.lock(trx, id);
      if (!OPEN_DISPUTE.includes(d.status as DisputeStatus)) throw new ProblemError(409, "closed", "this dispute is already closed");
      const actor: EventActor = { type: "user", id: auth.user.id };
      let reversal: string | null = null;
      if (body.outcome === "won") {
        const line = await this.ledger.post(trx, tenantId, d.order_id, {
          kind: "chargeback_reversal", method: d.method ?? "card", amountMinor: BigInt(d.amount_minor), currency: d.currency, source: "manual",
          externalRef: `dispute:${id}:won`, recordedBy: auth.user.id, note: `D-${d.number}`, occurredAt: now,
        }, actor);
        reversal = line.id;
      }
      const notes = [d.note, body.note].filter(Boolean).join("\n").slice(0, 500) || null;
      await trx.updateTable("disputes").set({ status: body.outcome, closed_at: now, updated_at: now, reversal_payment_id: reversal, note: notes }).where("id", "=", id).execute();
      await this.events.emit(trx, {
        type: "dispute.closed", tenantId, entity: { type: "order", id: d.order_id }, actor,
        data: { disputeId: id, dispute: `D-${d.number}`, outcome: body.outcome, amountMinor: String(d.amount_minor), feeMinor: String(d.fee_minor), currency: d.currency },
      });
      await this.audit.record(trx, {
        action: "dispute.closed", tenantId, entity: { type: "order", id: d.order_id },
        before: { status: d.status }, after: { disputeId: id, dispute: `D-${d.number}`, status: body.outcome }, ...auditActor(auth),
      });
      return this.view(trx, id, now);
    });
  }

  /**
   * The evidence pack: the order, who it went to and where, its delivery with the courier's
   * events, the confirmation and the WhatsApp exchange (actions, not bodies), and the payments.
   * The customer's name and address are decrypted for this caller; the access is audited.
   */
  async evidence(auth: AuthContext, id: string, now = new Date()): Promise<EvidencePack> {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const dispute = await this.view(trx, id, now);
      const orderId = dispute.order.id;
      const o = await trx.selectFrom("orders").selectAll().where("id", "=", orderId).executeTakeFirstOrThrow();
      const t = await trx.selectFrom("tenants").select(["name", "country"]).where("id", "=", tenantId).executeTakeFirstOrThrow();
      const [lines, payments, shipments, runs, messages] = await Promise.all([
        trx.selectFrom("order_lines").select(["title", "sku", "quantity", "unit_price_minor"]).where("order_id", "=", orderId).orderBy("id").execute(),
        trx.selectFrom("payments").select(["kind", "method", "status", "amount_minor", "currency", "occurred_at"]).where("order_id", "=", orderId).orderBy("occurred_at").execute(),
        trx.selectFrom("shipments").select(["id", "provider", "tracking_number", "tracking_url", "status", "status_at"]).where("order_id", "=", orderId).orderBy("created_at").execute(),
        trx.selectFrom("confirmation_runs").select(["started_at", "finished_at", "outcome", "answered_channel"]).where("order_id", "=", orderId).orderBy("started_at").execute(),
        trx.selectFrom("whatsapp_messages").select(["created_at", "direction", "kind", "action", "status"]).where("order_id", "=", orderId).orderBy("created_at").limit(100).execute(),
      ]);
      const events = shipments.length
        ? await trx.selectFrom("shipment_events").select(["shipment_id", "status", "occurred_at", "source"]).where("shipment_id", "in", shipments.map((s) => s.id)).orderBy("occurred_at").execute()
        : [];
      const m = (minor: bigint | string | number, currency = o.currency) => fromMinor(BigInt(minor), currency);
      let customer: EvidencePack["customer"] = null;
      if (!o.pii_redacted_at) {
        const pii = await this.cipher.forTenant(trx, tenantId);
        customer = {
          name: pii.decrypt(o.ship_name, "orders.ship_name"), phoneLast4: o.phone_last4,
          address: { line1: pii.decrypt(o.ship_line1, "orders.ship_line1"), line2: pii.decrypt(o.ship_line2, "orders.ship_line2"), city: o.ship_city, province: o.ship_province, country: o.ship_country },
        };
        await this.audit.record(trx, {
          action: "dispute.evidence_viewed", tenantId, entity: { type: "order", id: orderId },
          after: { disputeId: id, fields: ["ship_name", "ship_line1", "ship_line2"] }, ...auditActor(auth),
        });
      }
      return {
        dispute, store: { name: t.name, country: t.country }, generatedAt: now.toISOString(),
        order: {
          number: o.number, channel: o.channel, status: o.status, paymentMode: o.payment_mode, placedAt: o.placed_at.toISOString(),
          confirmedAt: iso(o.confirmed_at), shippedAt: iso(o.shipped_at), deliveredAt: iso(o.delivered_at),
          subtotal: m(o.subtotal_minor), shipping: m(o.shipping_minor), discount: m(o.discount_minor), total: m(o.total_minor),
          lines: lines.map((l) => ({ title: l.title, sku: l.sku, quantity: l.quantity, unitPrice: m(l.unit_price_minor), total: m(BigInt(l.unit_price_minor) * BigInt(l.quantity)) })),
        },
        customer,
        payments: payments.map((p) => ({ kind: p.kind, method: p.method, status: p.status, amount: m(p.amount_minor, p.currency), at: p.occurred_at.toISOString() })),
        shipments: shipments.map((s) => ({
          courier: s.provider, trackingNumber: s.tracking_number, trackingUrl: s.tracking_url, status: s.status, statusAt: iso(s.status_at),
          events: events.filter((e) => e.shipment_id === s.id).map((e) => ({ status: e.status, at: e.occurred_at.toISOString(), source: e.source })),
        })),
        confirmation: runs.map((r) => ({ startedAt: r.started_at.toISOString(), finishedAt: iso(r.finished_at), outcome: r.outcome, channel: r.answered_channel })),
        messages: messages.map((x) => ({ at: x.created_at.toISOString(), direction: x.direction as "in" | "out", kind: x.kind, action: x.action, status: x.status })),
      };
    });
  }

  private base(trx: Trx) {
    return trx.selectFrom("disputes as d").innerJoin("orders as o", "o.id", "d.order_id").leftJoin("users as u", "u.id", "d.opened_by")
      .leftJoin("payments as p", "p.id", "d.payment_id")
      .select(["d.id", "d.number", "d.order_id", "o.number as order_number", "d.status", "d.reason_code", "d.amount_minor", "d.fee_minor", "d.currency", "p.method",
        "d.source", "d.respond_by", "d.external_ref", "d.note", "d.evidence", "u.display_name", "d.evidence_submitted_at", "d.closed_at", "d.created_at"]);
  }

  private async view(trx: Trx, id: string, now: Date): Promise<Dispute> {
    const r = await this.base(trx).where("d.id", "=", id).executeTakeFirst();
    if (!r) throw notFound();
    return this.shape(r, now);
  }

  private shape(r: Awaited<ReturnType<ReturnType<DisputesService["base"]>["executeTakeFirstOrThrow"]>>, now: Date): Dispute {
    const open = OPEN_DISPUTE.includes(r.status as DisputeStatus);
    const evidence = (typeof r.evidence === "string" ? JSON.parse(r.evidence) : r.evidence) as { note?: string | null } | null;
    return {
      id: r.id, number: `D-${r.number}`, order: { id: r.order_id, number: r.order_number }, status: r.status as DisputeStatus,
      reason: r.reason_code as Dispute["reason"], amount: fromMinor(BigInt(r.amount_minor), r.currency), fee: fromMinor(BigInt(r.fee_minor), r.currency),
      method: r.method, source: r.source as Dispute["source"], respondBy: iso(r.respond_by),
      daysLeft: open && r.respond_by ? Math.ceil((r.respond_by.getTime() - now.getTime()) / DAY) : null,
      externalRef: r.external_ref, note: r.note, evidenceNote: evidence?.note ?? null, openedBy: r.display_name,
      evidenceSubmittedAt: iso(r.evidence_submitted_at), closedAt: iso(r.closed_at), createdAt: r.created_at.toISOString(),
    };
  }

  private async lock(trx: Trx, id: string) {
    const d = await trx.selectFrom("disputes as d").leftJoin("payments as p", "p.id", "d.payment_id")
      .select(["d.id", "d.order_id", "d.number", "d.status", "d.amount_minor", "d.fee_minor", "d.currency", "d.note", "p.method"])
      .where("d.id", "=", id).forUpdate("d").executeTakeFirst();
    if (!d) throw notFound();
    return d;
  }
}

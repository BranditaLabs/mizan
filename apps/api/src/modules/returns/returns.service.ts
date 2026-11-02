import { Inject, Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import type { DB } from "@mizan/db";
import type { EventActor } from "@mizan/shared";
import { auditActor, AuditService } from "../../platform/audit/audit.service.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { Database } from "../../platform/db/database.js";
import { EventsService } from "../../platform/events/events.service.js";
import { ProblemError } from "../../platform/http/problem.js";
import type { InspectBody, InspectionOutcome, ReturnState } from "./returns.dto.js";

type Trx = Transaction<DB>;
/** Orders whose goods can come back: refused or returned by the courier, or delivered and sent back. */
const ELIGIBLE = new Set(["returned", "delivered"]);
const INSPECTORS = new Set(["owner", "admin", "ops_manager", "warehouse"]);

/**
 * Return inspection (M6, E10-3): what came back, line by line — sellable (restock), damaged, or
 * written off. A line is never inspected past its quantity (the order is locked). Each inspection
 * raises `return.inspected`: the warehouse puts restocked units back (M4) and the order's profit
 * counts the units lost (M5). Audited. Works the same from the web and the ops app.
 */
@Injectable()
export class ReturnsService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EventsService) private readonly events: EventsService,
  ) {}

  async state(auth: AuthContext, orderId: string): Promise<ReturnState> {
    return this.db.tenant(auth.tenant!.id, (trx) => this.read(trx, auth, orderId));
  }

  async inspect(auth: AuthContext, orderId: string, body: InspectBody): Promise<ReturnState> {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const r = await this.record(trx, tenantId, orderId, body, { type: "user", id: auth.user.id });
      await this.audit.record(trx, { action: "return.inspected", tenantId, entity: { type: "order", id: orderId }, after: r, ...auditActor(auth) });
      return this.read(trx, auth, orderId);
    });
  }

  /** Record an inspection inside the caller's transaction (the web, or an ops-app op with its id). */
  async record(trx: Trx, tenantId: string, orderId: string, body: InspectBody, actor: EventActor, deviceOpId?: string) {
    const o = await trx.selectFrom("orders").select(["id", "number", "status"]).where("id", "=", orderId).forUpdate().executeTakeFirst();
    if (!o) throw new ProblemError(404, "not_found", "order not found");
    if (!ELIGIBLE.has(o.status)) throw new ProblemError(409, "not_returned", "only a returned or delivered order's goods can be inspected");
    if (body.ticketId) {
      const tk = await trx.selectFrom("tickets").select("order_id").where("id", "=", body.ticketId).executeTakeFirst();
      if (!tk || tk.order_id !== orderId) throw new ProblemError(422, "validation_failed", "the ticket is not on this order", [{ path: "ticketId", code: "not_found", message: body.ticketId }]);
    }
    const lines = new Map((await this.lines(trx, orderId)).map((l) => [l.id, l]));
    const asked = new Map<string, number>();
    for (const [i, item] of body.items.entries()) {
      const l = lines.get(item.lineId);
      if (!l) throw new ProblemError(422, "validation_failed", "this line is not on the order", [{ path: `items.${i}.lineId`, code: "not_found", message: item.lineId }]);
      asked.set(item.lineId, (asked.get(item.lineId) ?? 0) + item.quantity);
    }
    const over = [...asked].filter(([id, n]) => n > lines.get(id)!.remaining);
    if (over.length) {
      throw new ProblemError(409, "over_quantity", "more units than are left to inspect", over.map(([id, n]) => ({ path: "items", code: "over_quantity", message: `${lines.get(id)!.title}: ${n} > ${lines.get(id)!.remaining}` })));
    }
    const rows = await trx.insertInto("return_inspections").values(body.items.map((item) => ({
      tenant_id: tenantId, order_id: orderId, order_line_id: item.lineId, variant_id: lines.get(item.lineId)!.variant_id, ticket_id: body.ticketId ?? null,
      quantity: item.quantity, outcome: item.outcome, note: body.note ?? null, inspected_by: actor.type === "user" ? actor.id ?? null : null, device_op_id: deviceOpId ?? null,
    }))).returning(["id", "order_line_id", "variant_id", "quantity", "outcome"]).execute();
    const items = rows.map((r) => ({ inspectionId: r.id, lineId: r.order_line_id, variantId: r.variant_id, quantity: r.quantity, outcome: r.outcome as InspectionOutcome }));
    const left = [...lines.values()].reduce((a, l) => a + l.remaining, 0) - body.items.reduce((a, i) => a + i.quantity, 0);
    const data = { number: o.number, items, ticketId: body.ticketId ?? null, complete: left === 0 };
    await this.events.emit(trx, { type: "return.inspected", tenantId, entity: { type: "order", id: orderId }, actor, data });
    return data;
  }

  private async lines(trx: Trx, orderId: string) {
    const lines = await trx.selectFrom("order_lines as l").leftJoin("variants as v", "v.id", "l.variant_id")
      .select(["l.id", "l.title", "l.quantity", "l.variant_id", "v.sku"]).where("l.order_id", "=", orderId).orderBy("l.external_line_id").execute();
    const done = await trx.selectFrom("return_inspections").select(["order_line_id", "outcome", sql<string>`sum(quantity)`.as("n")])
      .where("order_id", "=", orderId).groupBy(["order_line_id", "outcome"]).execute();
    const by = (id: string, outcome: string) => Number(done.find((d) => d.order_line_id === id && d.outcome === outcome)?.n ?? 0);
    return lines.map((l) => {
      const restock = by(l.id, "restock");
      const damaged = by(l.id, "damaged");
      const writeOff = by(l.id, "write_off");
      return { ...l, restock, damaged, writeOff, remaining: Math.max(0, l.quantity - restock - damaged - writeOff) };
    });
  }

  private async read(trx: Trx, auth: AuthContext, orderId: string): Promise<ReturnState> {
    const o = await trx.selectFrom("orders").select(["id", "status"]).where("id", "=", orderId).executeTakeFirst();
    if (!o) throw new ProblemError(404, "not_found", "order not found");
    const lines = await this.lines(trx, orderId);
    const titles = new Map(lines.map((l) => [l.id, l.title]));
    const done = await trx.selectFrom("return_inspections as r").leftJoin("users as u", "u.id", "r.inspected_by")
      .select(["r.id", "r.order_line_id", "r.quantity", "r.outcome", "r.note", "r.created_at", "u.display_name", "u.email"])
      .where("r.order_id", "=", orderId).orderBy("r.created_at", "desc").orderBy("r.id").execute();
    const eligible = ELIGIBLE.has(o.status);
    return {
      orderId, eligible, canInspect: eligible && INSPECTORS.has(auth.tenant!.role) && lines.some((l) => l.remaining > 0),
      lines: lines.map((l) => ({ lineId: l.id, title: l.title, sku: l.sku, variantId: l.variant_id, quantity: l.quantity, restock: l.restock, damaged: l.damaged, writeOff: l.writeOff, remaining: l.remaining })),
      inspections: done.map((d) => ({
        id: d.id, lineId: d.order_line_id, title: titles.get(d.order_line_id) ?? "", quantity: d.quantity, outcome: d.outcome as InspectionOutcome,
        note: d.note, by: d.display_name ?? d.email, at: d.created_at.toISOString(),
      })),
    };
  }
}

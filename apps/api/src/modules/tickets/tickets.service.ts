import { Inject, Injectable } from "@nestjs/common";
import { sql, type ExpressionBuilder, type Transaction } from "kysely";
import type { DB } from "@mizan/db";
import type { EventActor } from "@mizan/shared";
import { auditActor, AuditService } from "../../platform/audit/audit.service.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { Database } from "../../platform/db/database.js";
import { EventsService } from "../../platform/events/events.service.js";
import { ProblemError } from "../../platform/http/problem.js";
import type { ListTicketsQuery, NewTicket, Ticket, UpdateTicket } from "./tickets.dto.js";
import { DONE, isLate, moveRefusal, SLA_HOURS, stamps, VIEW_STATUSES, type TicketStatus } from "./tickets.rules.js";

type Trx = Transaction<DB>;
type T = ExpressionBuilder<DB & { t: DB["tickets"] }, "t">;

/** Roles that see every ticket; agents see theirs, the ones they opened and the unassigned queue. */
const SEE_ALL = new Set(["owner", "admin", "ops_manager", "finance", "warehouse"]);
/** Roles that change tickets (agents within their scope); warehouse adds notes only. */
const EDIT = new Set(["owner", "admin", "ops_manager", "finance", "agent"]);
/** Roles that assign tickets to anyone; an agent takes or drops a ticket for themselves only. */
const ASSIGN_ANY = new Set(["owner", "admin", "ops_manager", "finance"]);
/** Who a ticket can be assigned to. */
const ASSIGNABLE = ["owner", "admin", "ops_manager", "agent", "finance", "warehouse"] as const;

const label = (n: number) => `T-${n}`;
const encode = (at: Date, id: string) => Buffer.from(`${at.toISOString()}|${id}`).toString("base64url");
function decode(cursor: string) {
  const [at, id] = Buffer.from(cursor, "base64url").toString().split("|");
  const d = new Date(at ?? "");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id) || Number.isNaN(d.getTime())) throw new ProblemError(422, "validation_failed", "cursor is not valid", [{ path: "cursor", code: "invalid" }]);
  return { at: d, id };
}

/**
 * Tickets (M6, E10-1): complaints, exchanges, refunds, delivery issues, returns and refusals at
 * the door, each linked to its order, numbered per store (T-1001), with a fixed reason code, an
 * assignee, a deadline (24 h) and a history. Every change is one transaction: the ticket, its
 * history line, the domain event and the audit entry. The description and notes are the team's
 * words: they stay on the ticket, never in events or the audit log.
 */
@Injectable()
export class TicketsService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EventsService) private readonly events: EventsService,
  ) {}

  async list(auth: AuthContext, q: ListTicketsQuery) {
    const after = q.cursor ? decode(q.cursor) : null;
    return this.db.tenant(auth.tenant!.id, async (trx) => {
      const scope = this.scope(auth);
      let rows = this.select(trx).where((eb) => scope(eb as never)).orderBy("t.created_at", "desc").orderBy("t.id", "desc").limit(q.limit + 1);
      if (q.view === "late") rows = rows.where("t.status", "not in", [...DONE]).where("t.due_at", "<", sql<Date>`now()`);
      else if (q.view !== "all") rows = rows.where("t.status", "in", VIEW_STATUSES[q.view]);
      if (q.type) rows = rows.where("t.type", "=", q.type);
      if (q.orderId) rows = rows.where((eb) => eb.or([eb("t.order_id", "=", q.orderId!), eb("t.linked_order_id", "=", q.orderId!)]));
      if (q.mine) rows = rows.where("t.assigned_to", "=", auth.user.id);
      if (q.q) {
        const n = /^(?:t-?)?(\d{1,9})$/i.exec(q.q.trim());
        const num = q.q.trim().replace(/^#/, "");
        rows = rows.where((eb) => eb.or([
          ...(n ? [eb("t.number", "=", Number(n[1]))] : []),
          eb("o.number", "in", [num, `#${num}`]),
        ]));
      }
      if (after) rows = rows.where((eb) => eb.or([eb("t.created_at", "<", after.at), eb.and([eb("t.created_at", "=", after.at), eb("t.id", "<", after.id)])]));
      const found = await rows.execute();
      const groups = await trx.selectFrom("tickets as t").where((eb) => scope(eb as never))
        .select(["t.status", sql<string>`count(*)`.as("n"), sql<string>`count(*) filter (where t.due_at < now())`.as("late")]).groupBy("t.status").execute();
      const by = (statuses: readonly string[]) => groups.filter((g) => statuses.includes(g.status)).reduce((a, g) => a + Number(g.n), 0);
      const page = found.slice(0, q.limit);
      const last = page.at(-1);
      const now = new Date();
      return {
        data: page.map((r) => this.summary(r, now)),
        counts: {
          active: by(VIEW_STATUSES.active), open: by(VIEW_STATUSES.open), waiting: by(VIEW_STATUSES.waiting), inspection: by(VIEW_STATUSES.inspection),
          resolved: by(VIEW_STATUSES.resolved), closed: by(VIEW_STATUSES.closed),
          late: groups.filter((g) => !DONE.has(g.status)).reduce((a, g) => a + Number(g.late), 0),
        },
        nextCursor: found.length > q.limit && last ? encode(last.created_at, last.id) : null,
      };
    });
  }

  async get(auth: AuthContext, id: string): Promise<Ticket> {
    return this.db.tenant(auth.tenant!.id, (trx) => this.read(trx, auth, id));
  }

  async create(auth: AuthContext, body: NewTicket): Promise<Ticket> {
    const tenantId = auth.tenant!.id;
    const role = auth.tenant!.role;
    return this.db.tenant(tenantId, async (trx) => {
      const orderId = body.orderId ?? (body.orderNumber ? await this.orderByNumber(trx, body.orderNumber) : null);
      if (body.orderId && !(await trx.selectFrom("orders").select("id").where("id", "=", body.orderId).executeTakeFirst())) {
        throw new ProblemError(422, "validation_failed", "this order does not exist in this store", [{ path: "orderId", code: "not_found", message: body.orderId }]);
      }
      if (body.assignedTo) await this.checkAssignee(trx, auth, body.assignedTo);
      else if (role === "agent") body.assignedTo = auth.user.id; // an agent's ticket is theirs
      // One open case of a kind per order: a second one is the same case.
      await sql`select pg_advisory_xact_lock(hashtext(${`tickets:${tenantId}`}))`.execute(trx);
      if (orderId) {
        const open = await trx.selectFrom("tickets").select(["id", "number"]).where("order_id", "=", orderId).where("type", "=", body.type).where("status", "not in", [...DONE]).executeTakeFirst();
        if (open) throw new ProblemError(409, "ticket_open", `${label(open.number)} is already open for this order`, [{ path: "orderId", code: "ticket_open", message: open.id }]);
      }
      const next = await trx.selectFrom("tickets").select(sql<number>`coalesce(max(number), 1000) + 1`.as("n")).executeTakeFirstOrThrow();
      const now = new Date();
      const t = await trx.insertInto("tickets").values({
        tenant_id: tenantId, number: Number(next.n), type: body.type, reason: body.reason ?? null, order_id: orderId, description: body.description ?? null,
        source: body.source, assigned_to: body.assignedTo ?? null, created_by: auth.user.id, due_at: new Date(now.getTime() + SLA_HOURS * 3600_000), created_at: now, updated_at: now,
      }).returning(["id", "number"]).executeTakeFirstOrThrow();
      await this.history(trx, tenantId, t.id, "created", auth.user.id, { type: body.type, reason: body.reason ?? null, ...(body.assignedTo ? { assignedTo: body.assignedTo } : {}) });
      const actor: EventActor = { type: "user", id: auth.user.id };
      const data = { number: label(t.number), type: body.type, reason: body.reason ?? null, orderId, source: body.source, assignedTo: body.assignedTo ?? null };
      await this.events.emit(trx, { type: "ticket.created", tenantId, entity: { type: "ticket", id: t.id }, actor, data });
      await this.audit.record(trx, { action: "ticket.created", tenantId, entity: { type: "ticket", id: t.id }, after: data, ...auditActor(auth) });
      return this.read(trx, auth, t.id);
    });
  }

  async update(auth: AuthContext, id: string, body: UpdateTicket): Promise<Ticket> {
    const tenantId = auth.tenant!.id;
    const role = auth.tenant!.role;
    return this.db.tenant(tenantId, async (trx) => {
      const t = await trx.selectFrom("tickets as t").selectAll("t").where("t.id", "=", id).where((eb) => this.scope(auth)(eb as never)).forUpdate().executeTakeFirst();
      if (!t) throw new ProblemError(404, "not_found", "ticket not found");
      const changes = body.status !== undefined || body.type !== undefined || body.reason !== undefined || body.assignedTo !== undefined;
      if (changes && !EDIT.has(role)) throw new ProblemError(403, "forbidden", "your role can add notes to tickets, not change them");
      const from = t.status as TicketStatus;
      if (changes && from === "closed") throw new ProblemError(409, "ticket_closed", "a closed ticket cannot change; open a new one");
      if (body.assignedTo !== undefined && body.assignedTo !== t.assigned_to) {
        if (body.assignedTo) await this.checkAssignee(trx, auth, body.assignedTo);
        else if (!ASSIGN_ANY.has(role) && t.assigned_to !== auth.user.id) throw new ProblemError(403, "forbidden", "you can only drop a ticket assigned to you");
      }
      const to = (body.status ?? from) as TicketStatus;
      const refused = moveRefusal(from, to);
      if (refused) throw new ProblemError(409, refused, "a closed ticket cannot change; open a new one");

      const now = new Date();
      const actor: EventActor = { type: "user", id: auth.user.id };
      const entity = { type: "ticket", id };
      const base = { number: label(t.number), orderId: t.order_id };
      const set: Record<string, unknown> = { updated_at: now, ...stamps(from, to, now) };
      if (to !== from) set.status = to;
      const updated: Record<string, unknown> = {};
      if (body.type !== undefined && body.type !== t.type) { set.type = body.type; updated.type = { from: t.type, to: body.type }; }
      if (body.reason !== undefined && body.reason !== t.reason) { set.reason = body.reason; updated.reason = { from: t.reason, to: body.reason }; }
      const assigned = body.assignedTo !== undefined && body.assignedTo !== t.assigned_to;
      if (assigned) set.assigned_to = body.assignedTo;
      await trx.updateTable("tickets").set(set).where("id", "=", id).execute();

      if (to !== from) {
        await this.history(trx, tenantId, id, "status", auth.user.id, { from, to });
        await this.events.emit(trx, { type: "ticket.status_changed", tenantId, entity, actor, data: { ...base, type: (body.type ?? t.type), from, to } });
      }
      if (assigned) {
        await this.history(trx, tenantId, id, "assigned", auth.user.id, { from: t.assigned_to, to: body.assignedTo });
        await this.events.emit(trx, { type: "ticket.assigned", tenantId, entity, actor, data: { ...base, assignedTo: body.assignedTo } });
      }
      if (Object.keys(updated).length) await this.history(trx, tenantId, id, "updated", auth.user.id, updated);
      if (body.note) await this.history(trx, tenantId, id, "note", auth.user.id, {}, body.note);
      if (to !== from || assigned || Object.keys(updated).length) {
        await this.audit.record(trx, {
          action: "ticket.updated", tenantId, entity, ...auditActor(auth),
          before: { status: from, type: t.type, reason: t.reason, assignedTo: t.assigned_to },
          after: { status: to, type: body.type ?? t.type, reason: body.reason === undefined ? t.reason : body.reason, assignedTo: body.assignedTo === undefined ? t.assigned_to : body.assignedTo },
        });
      }
      return this.read(trx, auth, id);
    });
  }

  /** Agents see the tickets assigned to them, those they opened, and the unassigned queue. */
  private scope(auth: AuthContext) {
    const me = auth.user.id;
    return (eb: T) => (SEE_ALL.has(auth.tenant!.role) ? eb.val(true)
      : eb.or([eb("t.assigned_to", "=", me), eb("t.created_by", "=", me), eb("t.assigned_to", "is", null)]));
  }

  private select(trx: Trx) {
    return trx.selectFrom("tickets as t").leftJoin("orders as o", "o.id", "t.order_id").leftJoin("users as a", "a.id", "t.assigned_to")
      .select(["t.id", "t.number", "t.type", "t.reason", "t.status", "t.source", "t.order_id", "o.number as order_number", "o.status as order_status",
        "t.assigned_to", "a.display_name as assignee_name", "a.email as assignee_email", "t.due_at", "t.created_at", "t.updated_at"]);
  }

  private summary(r: Awaited<ReturnType<ReturnType<TicketsService["select"]>["executeTakeFirstOrThrow"]>>, now: Date) {
    return {
      id: r.id, number: label(r.number), type: r.type as Ticket["type"], reason: r.reason as Ticket["reason"], status: r.status as Ticket["status"], source: r.source as Ticket["source"],
      order: r.order_id && r.order_number ? { id: r.order_id, number: r.order_number, status: r.order_status! } : null,
      assignee: r.assigned_to ? { id: r.assigned_to, name: r.assignee_name ?? r.assignee_email } : null,
      dueAt: r.due_at?.toISOString() ?? null, late: isLate(r.status, r.due_at, now),
      createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(),
    };
  }

  private async read(trx: Trx, auth: AuthContext, id: string): Promise<Ticket> {
    const r = await this.select(trx).leftJoin("users as c", "c.id", "t.created_by")
      .select(["t.description", "t.created_by", "c.display_name as creator_name", "c.email as creator_email", "t.resolved_at", "t.closed_at"])
      .where("t.id", "=", id).where((eb) => this.scope(auth)(eb as never)).executeTakeFirst();
    if (!r) throw new ProblemError(404, "not_found", "ticket not found");
    const history = await trx.selectFrom("ticket_events as e").leftJoin("users as u", "u.id", "e.actor_id")
      .select(["e.id", "e.type", "e.created_at", "e.actor_id", "u.display_name", "u.email", "e.data", "e.note"])
      .where("e.ticket_id", "=", id).orderBy("e.seq", "desc").execute();
    const role = auth.tenant!.role;
    const assignees = ASSIGN_ANY.has(role)
      ? await trx.selectFrom("memberships as m").innerJoin("users as u", "u.id", "m.user_id").select(["u.id", "u.display_name", "u.email", "m.role"])
        .where("m.status", "=", "active").where("m.role", "in", [...ASSIGNABLE]).orderBy("u.display_name").execute()
      : role === "agent" ? [{ id: auth.user.id, display_name: auth.user.displayName, email: auth.user.email, role }] : [];
    return {
      ...this.summary(r, new Date()),
      description: r.description, createdBy: r.created_by ? { id: r.created_by, name: r.creator_name ?? r.creator_email } : null,
      resolvedAt: r.resolved_at?.toISOString() ?? null, closedAt: r.closed_at?.toISOString() ?? null,
      canEdit: EDIT.has(role) && r.status !== "closed",
      assignees: assignees.map((a) => ({ id: a.id, name: a.display_name ?? a.email, role: a.role })),
      history: history.map((e) => ({
        id: e.id, type: e.type as Ticket["history"][number]["type"], at: e.created_at.toISOString(),
        actor: e.actor_id ? { id: e.actor_id, name: e.display_name ?? e.email } : null,
        data: (typeof e.data === "string" ? JSON.parse(e.data) : e.data) as Record<string, unknown>, note: e.note,
      })),
    };
  }

  private async history(trx: Trx, tenantId: string, ticketId: string, type: "created" | "status" | "assigned" | "updated" | "note", actorId: string, data: Record<string, unknown>, note?: string) {
    await trx.insertInto("ticket_events").values({ tenant_id: tenantId, ticket_id: ticketId, type, actor_id: actorId, data: JSON.stringify(data), note: note ?? null }).execute();
  }

  private async orderByNumber(trx: Trx, number: string): Promise<string> {
    const n = number.trim().replace(/^#/, "");
    const o = await trx.selectFrom("orders").select("id").where("number", "in", [n, `#${n}`]).orderBy("placed_at", "desc").limit(1).executeTakeFirst();
    if (!o) throw new ProblemError(422, "validation_failed", "no order with this number in this store", [{ path: "orderNumber", code: "not_found", message: number }]);
    return o.id;
  }

  private async checkAssignee(trx: Trx, auth: AuthContext, userId: string) {
    if (!ASSIGN_ANY.has(auth.tenant!.role) && userId !== auth.user.id) throw new ProblemError(403, "forbidden", "you can assign tickets to yourself only");
    const m = await trx.selectFrom("memberships").select("role").where("user_id", "=", userId).where("status", "=", "active").executeTakeFirst();
    if (!m || !(ASSIGNABLE as readonly string[]).includes(m.role)) {
      throw new ProblemError(422, "validation_failed", "this person is not an active member who handles tickets", [{ path: "assignedTo", code: "not_member", message: userId }]);
    }
  }
}

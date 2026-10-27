import { Inject, Injectable } from "@nestjs/common";
import { sql, type RawBuilder, type SqlBool, type Transaction } from "kysely";
import type { DB } from "@mizan/db";
import type { ShipmentStatusUpdate } from "@mizan/engine";
import { fromMinor, TERMINAL_STATUSES, type EventActor, type ShipmentStatus } from "@mizan/shared";
import { auditActor, AuditService } from "../../platform/audit/audit.service.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { Database } from "../../platform/db/database.js";
import { EventsService } from "../../platform/events/events.service.js";
import { ProblemError } from "../../platform/http/problem.js";
import { SHIPMENT_VIEWS, type ListShipmentsQuery, type SetStatusBody, type ShipmentListView, type ShipmentPage } from "./tracking.dto.js";

type Trx = Transaction<DB>;
interface Change { status: ShipmentStatus; raw: string | null; at: Date; source: "webhook" | "poll" | "ops"; needsReview: boolean; note?: string | undefined; userId?: string | undefined }

const ACTIVE = sql.join(["created", "pickup_requested", "picked_up", "in_transit", "out_for_delivery", "failed_attempt", "unknown"].map((s) => sql.lit(s)));
const VIEW_SQL: Record<ShipmentListView, RawBuilder<SqlBool>> = {
  active: sql<SqlBool>`s.booking <> 'failed' and s.status in (${ACTIVE})`,
  review: sql<SqlBool>`(s.needs_review or s.booking = 'failed')`,
  delivered: sql<SqlBool>`s.status = 'delivered'`,
  returned: sql<SqlBool>`s.status in ('returning', 'returned')`,
  all: sql<SqlBool>`true`,
};
const rawText = (raw: ShipmentStatusUpdate["raw"]) => raw.label ?? (raw.code !== undefined ? String(raw.code) : null);
const encode = (at: Date, id: string) => Buffer.from(`${at.toISOString()}|${id}`).toString("base64url");
function decode(cursor: string) {
  const [at, id] = Buffer.from(cursor, "base64url").toString().split("|");
  const d = new Date(at ?? "");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id) || Number.isNaN(d.getTime())) throw new ProblemError(422, "validation_failed", "cursor is not valid", [{ path: "cursor", code: "invalid" }]);
  return { at: d, id };
}

/**
 * M3 tracking (E7-3): the courier's statuses on Mizan's shipments and orders. A mapped status moves
 * the shipment (and the order: delivered, returned); a status Mizan could not map keeps the last
 * good one and puts the shipment in the review queue — a terminal status is never guessed (rule 7).
 * Once a shipment is delivered, returned, cancelled or lost, only a person changes it (an audited
 * override); a later courier status that disagrees goes to review instead.
 */
@Injectable()
export class TrackingService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EventsService) private readonly events: EventsService,
  ) {}

  /** From the engine (webhook or poll), for the courier connection that owns the tracking number. */
  async recordStatus(tenantId: string, connectionId: string, u: ShipmentStatusUpdate): Promise<void> {
    await this.db.tenant(tenantId, async (trx) => {
      const s = await this.lock(trx, (q) => q.where("s.connection_id", "=", connectionId).where("s.tracking_number", "=", u.trackingNumber));
      if (!s) return; // booked outside Mizan's ship flow: nothing of ours to move
      await this.apply(trx, tenantId, s, { status: u.status, raw: rawText(u.raw), at: new Date(u.at), source: u.source, needsReview: u.needsReview }, { type: "engine" });
    });
  }

  /** A person sets the status (the courier said so on the phone, the label was seen): audited. */
  async setStatus(auth: AuthContext, id: string, body: SetStatusBody, now = new Date()) {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const s = await this.lock(trx, (q) => q.where("s.id", "=", id));
      if (!s) throw new ProblemError(404, "not_found", "shipment not found");
      if (s.booking !== "booked") throw new ProblemError(409, "not_booked", "the courier has not booked this shipment");
      const before = { status: s.status, needsReview: s.needs_review };
      await this.apply(trx, tenantId, s, { status: body.status as ShipmentStatus, raw: null, at: now, source: "ops", needsReview: false, note: body.note, userId: auth.user.id }, { type: "user", id: auth.user.id });
      await this.audit.record(trx, { action: "shipment.status_set", tenantId, entity: { type: "shipment", id }, before, after: { status: body.status, note: body.note ?? null }, ...auditActor(auth) });
      return { id, status: body.status };
    });
  }

  async history(tenantId: string, id: string) {
    return this.db.tenant(tenantId, async (trx) => {
      if (!(await trx.selectFrom("shipments").select("id").where("id", "=", id).executeTakeFirst())) throw new ProblemError(404, "not_found", "shipment not found");
      const rows = await trx.selectFrom("shipment_events").select(["status", "status_raw", "source", "occurred_at", "data"]).where("shipment_id", "=", id)
        .orderBy("occurred_at", "desc").orderBy("created_at", "desc").limit(100).execute();
      return { data: rows.map((r) => ({ status: r.status, statusRaw: r.status_raw, source: r.source as "ops", at: r.occurred_at.toISOString(), note: (r.data as { note?: string } | null)?.note ?? null })) };
    });
  }

  async list(auth: AuthContext, q: ListShipmentsQuery): Promise<ShipmentPage> {
    const after = q.cursor ? decode(q.cursor) : null;
    return this.db.tenant(auth.tenant!.id, async (trx) => {
      const search = q.q ? (() => { const n = q.q.replace(/^#/, ""); return sql<SqlBool>`(s.tracking_number = ${q.q} or o.number in (${n}, ${`#${n}`}))`; })() : sql<SqlBool>`true`;
      let rows = trx.selectFrom("shipments as s").innerJoin("orders as o", "o.id", "s.order_id")
        .select(["s.id", "s.provider", "s.booking", "s.status", "s.status_raw", "s.status_at", "s.needs_review", "s.error_code", "s.tracking_number", "s.tracking_url", "s.cod_minor", "s.currency", "s.created_at",
          "o.id as order_id", "o.number", "o.status as order_status", "o.ship_city", "o.ship_province"])
        .where("s.is_return_leg", "=", false).where(sql<SqlBool>`${VIEW_SQL[q.view]} and ${search}`)
        .orderBy("s.created_at", "desc").orderBy("s.id", "desc").limit(q.limit + 1);
      if (after) rows = rows.where((eb) => eb.or([eb("s.created_at", "<", after.at), eb.and([eb("s.created_at", "=", after.at), eb("s.id", "<", after.id)])]));
      const found = await rows.execute();
      const countSql = sql.join(SHIPMENT_VIEWS.map((v) => sql`count(*) filter (where ${VIEW_SQL[v]}) as ${sql.ref(v)}`));
      const counts = (await sql<Record<ShipmentListView, string>>`select ${countSql} from shipments s join orders o on o.id = s.order_id where not s.is_return_leg and ${search}`.execute(trx)).rows[0]!;
      const page = found.slice(0, q.limit);
      const last = page.at(-1);
      return {
        data: page.map((r) => ({
          id: r.id, order: { id: r.order_id, number: r.number, status: r.order_status }, provider: r.provider, booking: r.booking as "booked", status: r.status,
          statusRaw: r.status_raw, statusAt: r.status_at?.toISOString() ?? null, needsReview: r.needs_review, errorCode: r.error_code,
          trackingNumber: r.tracking_number, trackingUrl: r.tracking_url, cod: fromMinor(BigInt(r.cod_minor), r.currency.trim()),
          area: { city: r.ship_city, province: r.ship_province }, createdAt: r.created_at.toISOString(),
        })),
        counts: Object.fromEntries(SHIPMENT_VIEWS.map((v) => [v, Number(counts[v])])) as ShipmentPage["counts"],
        nextCursor: found.length > q.limit && last ? encode(last.created_at, last.id) : null,
      };
    });
  }

  private lock(trx: Trx, where: (q: ReturnType<TrackingService["base"]>) => ReturnType<TrackingService["base"]>) {
    return where(this.base(trx)).forUpdate("s").executeTakeFirst();
  }

  private base(trx: Trx) {
    return trx.selectFrom("shipments as s").innerJoin("orders as o", "o.id", "s.order_id")
      .select(["s.id", "s.order_id", "s.status", "s.status_raw", "s.needs_review", "s.booking", "s.tracking_number", "s.provider", "o.number", "o.status as order_status"]);
  }

  private async apply(trx: Trx, tenantId: string, s: NonNullable<Awaited<ReturnType<TrackingService["lock"]>>>, c: Change, actor: EventActor) {
    const current = s.status as ShipmentStatus;
    const ref = { orderId: s.order_id, number: s.number, provider: s.provider, trackingNumber: s.tracking_number };
    const review = async (conflict: boolean) => {
      if (s.needs_review && s.status_raw === c.raw) return; // already waiting for a person
      await trx.updateTable("shipments").set({ needs_review: true, status_raw: c.raw, updated_at: new Date() }).where("id", "=", s.id).execute();
      await this.event(trx, tenantId, s.id, conflict ? c.status : "unknown", c);
      await this.events.emit(trx, { type: "shipment.needs_review", tenantId, entity: { type: "shipment", id: s.id }, actor, data: { ...ref, raw: c.raw, current, ...(conflict ? { received: c.status } : {}) } });
    };
    if (c.needsReview) return review(false);
    if (c.source !== "ops" && TERMINAL_STATUSES.has(current) && c.status !== current) return review(true); // final: a person decides
    if (c.status === current) {
      if (c.source === "ops" && s.needs_review) { // a person confirmed what it is
        await trx.updateTable("shipments").set({ needs_review: false, updated_at: new Date() }).where("id", "=", s.id).execute();
        await this.event(trx, tenantId, s.id, c.status, c);
      }
      return;
    }
    await trx.updateTable("shipments").set({ status: c.status, status_raw: c.raw, status_at: c.at, needs_review: false, updated_at: new Date() }).where("id", "=", s.id).execute();
    await this.event(trx, tenantId, s.id, c.status, c);
    await this.events.emit(trx, { type: "shipment.status_changed", tenantId, entity: { type: "shipment", id: s.id }, actor, data: { ...ref, from: current, to: c.status, source: c.source } });
    if (c.status === "delivered") await this.events.emit(trx, { type: "shipment.delivered", tenantId, entity: { type: "shipment", id: s.id }, actor, data: ref });
    if (c.status === "returned") await this.events.emit(trx, { type: "shipment.returned", tenantId, entity: { type: "shipment", id: s.id }, actor, data: ref });

    // The order follows the parcel's end: delivered, or back with the merchant.
    const next = c.status === "delivered" && ["shipped", "returned"].includes(s.order_status) ? "delivered"
      : c.status === "returned" && ["shipped", "delivered"].includes(s.order_status) ? "returned" : null;
    await trx.insertInto("order_events").values({
      tenant_id: tenantId, order_id: s.order_id, type: "shipment_status", from_status: s.order_status, to_status: next ?? s.order_status,
      actor_type: c.userId ? "user" : "system", actor_id: c.userId ?? null, data: JSON.stringify({ shipmentId: s.id, status: c.status, trackingNumber: s.tracking_number, source: c.source }),
    }).execute();
    if (next) {
      await trx.updateTable("orders").set({ status: next, ...(next === "delivered" ? { delivered_at: c.at } : {}), updated_at: new Date() }).where("id", "=", s.order_id).execute();
      await this.events.emit(trx, { type: "order.updated", tenantId, entity: { type: "order", id: s.order_id }, actor, data: { number: s.number, status: next, changed: ["status"] } });
    }
  }

  private event(trx: Trx, tenantId: string, shipmentId: string, status: string, c: Change) {
    return trx.insertInto("shipment_events").values({
      tenant_id: tenantId, shipment_id: shipmentId, status, status_raw: c.raw, source: c.source, occurred_at: c.at, actor_id: c.userId ?? null,
      data: c.note ? JSON.stringify({ note: c.note }) : null,
    }).execute();
  }
}

import { Inject, Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import type { DB } from "@mizan/db";
import { auditActor, AuditService } from "../../platform/audit/audit.service.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { Database } from "../../platform/db/database.js";
import { ProblemError } from "../../platform/http/problem.js";
import { StockService } from "../stock/stock.service.js";
import { ReturnsService } from "../returns/returns.service.js";
import { PackPayloadSchema } from "../picking/picking.dto.js";
import { PackRefused, PickingService } from "../picking/picking.service.js";
import { OP_TYPES, ReturnInspectPayloadSchema, StockOpPayloadSchema, type OpsSyncBody } from "./ops.dto.js";

type Trx = Transaction<DB>;
type Stored = "applied" | "rejected" | "conflict";
interface Outcome { status: Stored; code: string | null; message: string | null; result: Record<string, unknown> | null }
const KIND = { "stock.receive": "receive", "stock.count": "count", "stock.adjust": "adjust" } as const;

/**
 * The ops app's batch sync (M4, E8-3; ADR-0005). The phone queues operations offline, each with
 * its own opId, and sends them when it can. Each op is applied once: the first sync stores the
 * outcome under (tenant, opId), and any replay (a lost response, a retry, two phones racing) gets
 * that same outcome back. Ops run in the order they happened on the phone, each in its own
 * savepoint, so one bad op never blocks the rest. Conflicts: the server's stock wins and the app
 * tells the user (e.g. a count under what confirmed orders hold).
 */
@Injectable()
export class OpsSyncService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(StockService) private readonly stock: StockService,
    @Inject(ReturnsService) private readonly returns: ReturnsService,
    @Inject(PickingService) private readonly picking: PickingService,
  ) {}

  async sync(auth: AuthContext, body: OpsSyncBody) {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const order = body.ops.map((op, i) => ({ op, i })).sort((a, b) => Date.parse(a.op.at) - Date.parse(b.op.at) || a.i - b.i);
      const results = new Array<{ opId: string; status: Stored | "duplicate"; original: Stored | null } & Omit<Outcome, "status">>(body.ops.length);
      for (const { op, i } of order) {
        await sql`savepoint ops_op`.execute(trx);
        const claimed = await trx.insertInto("ops_operations").values({
          tenant_id: tenantId, op_id: op.opId, device_id: body.deviceId, user_id: auth.user.id, type: op.type, status: "applied", client_at: new Date(op.at),
        }).onConflict((oc) => oc.doNothing()).returning("op_id").executeTakeFirst();
        if (!claimed) {
          await sql`release savepoint ops_op`.execute(trx);
          const first = await trx.selectFrom("ops_operations").select(["status", "code", "result"]).where("op_id", "=", op.opId).executeTakeFirstOrThrow();
          results[i] = { opId: op.opId, status: "duplicate", original: first.status as Stored, code: first.code, message: null, result: (first.result as Record<string, unknown> | null) ?? null };
          continue;
        }
        let outcome: Outcome;
        try {
          const result = await this.apply(trx, tenantId, auth, op, body.deviceId);
          outcome = { status: "applied", code: null, message: null, result };
          await trx.updateTable("ops_operations").set({ result: JSON.stringify(result) }).where("op_id", "=", op.opId).execute();
          await sql`release savepoint ops_op`.execute(trx);
        } catch (e) {
          if (!(e instanceof Refused) && !(e instanceof ProblemError && (e.status === 404 || e.status === 422 || e.code === "over_quantity" || e.code === "not_returned"))) throw e;
          await sql`rollback to savepoint ops_op`.execute(trx);
          outcome = e instanceof Refused ? e.outcome
            : e.code === "below_reserved" || e.code === "over_quantity" || e.code === "not_returned" ? { status: "conflict", code: e.code, message: e.errors?.[0]?.message ?? e.detail ?? null, result: null }
            : { status: "rejected", code: e.status === 404 ? "unknown_item" : e.code, message: e.detail ?? null, result: null };
          await trx.insertInto("ops_operations").values({
            tenant_id: tenantId, op_id: op.opId, device_id: body.deviceId, user_id: auth.user.id, type: op.type,
            status: outcome.status, code: outcome.code, client_at: new Date(op.at),
          }).execute();
        }
        results[i] = { opId: op.opId, original: null, ...outcome };
      }
      const tally = (s: string) => results.filter((r) => r.status === s).length;
      await this.audit.record(trx, {
        action: "ops.synced", tenantId, entity: { type: "device", id: body.deviceId },
        after: { ops: body.ops.length, applied: tally("applied"), duplicate: tally("duplicate"), rejected: tally("rejected"), conflict: tally("conflict") }, ...auditActor(auth),
      });
      return { serverTime: new Date().toISOString(), results };
    });
  }

  private async apply(trx: Trx, tenantId: string, auth: AuthContext, op: OpsSyncBody["ops"][number], deviceId: string): Promise<Record<string, unknown>> {
    if (!(OP_TYPES as readonly string[]).includes(op.type)) throw new Refused("rejected", "unknown_type", `no operation called ${op.type}`);
    if (op.type === "return.inspect") return this.inspect(trx, tenantId, auth, op);
    if (op.type === "order.pack") {
      // Scan-to-pack (E8-4c): packed only when what was scanned is exactly the order.
      const parsed = PackPayloadSchema.safeParse(op.payload);
      if (!parsed.success) throw new Refused("rejected", "invalid_payload", parsed.error.issues.map((x) => `${x.path.join(".") || "payload"}: ${x.message}`).join("; ").slice(0, 300));
      try {
        return await this.picking.pack(trx, tenantId, auth.user.id, parsed.data, op.opId, deviceId);
      } catch (e) {
        if (e instanceof PackRefused) throw new Refused(e.status, e.code, e.message);
        throw e;
      }
    }
    const parsed = StockOpPayloadSchema.safeParse(op.payload);
    if (!parsed.success) throw new Refused("rejected", "invalid_payload", parsed.error.issues.map((x) => `${x.path.join(".") || "payload"}: ${x.message}`).join("; ").slice(0, 300));
    const p = parsed.data;
    const kind = KIND[op.type as keyof typeof KIND];
    const bad = kind === "receive" ? p.quantity <= 0 : kind === "count" ? p.quantity < 0 : p.quantity === 0;
    if (bad) throw new Refused("rejected", "invalid_payload", `quantity: not valid for ${kind}`);
    if (kind === "adjust" && !p.reason) throw new Refused("rejected", "invalid_payload", "reason: an adjustment needs a reason");
    const variantId = await this.variant(trx, p);
    const r = await this.stock.apply(trx, tenantId, { type: "user", id: auth.user.id }, {
      items: [{ variantId, kind, quantity: p.quantity, ...(p.reason ? { reason: p.reason } : {}) }],
      note: p.note ?? `device ${deviceId}`,
    }, op.opId);
    const level = r.levels[0]!;
    return { variantId, onHand: level.onHand, reserved: level.reserved, available: level.available, ordersReserved: r.ordersReserved };
  }

  /** A returned order's items, scanned at the warehouse (E10-3): the same rules as the web. */
  private async inspect(trx: Trx, tenantId: string, auth: AuthContext, op: OpsSyncBody["ops"][number]): Promise<Record<string, unknown>> {
    const parsed = ReturnInspectPayloadSchema.safeParse(op.payload);
    if (!parsed.success) throw new Refused("rejected", "invalid_payload", parsed.error.issues.map((x) => `${x.path.join(".") || "payload"}: ${x.message}`).join("; ").slice(0, 300));
    const p = parsed.data;
    const n = p.orderNumber?.replace(/^#/, "");
    const order = await (p.orderId ? trx.selectFrom("orders").select("id").where("id", "=", p.orderId) : trx.selectFrom("orders").select("id").where("number", "in", [n!, `#${n}`]).orderBy("placed_at", "desc")).executeTakeFirst();
    if (!order) throw new Refused("rejected", "unknown_order", `no order ${p.orderNumber ?? p.orderId}`);
    const lines = await trx.selectFrom("order_lines as l").leftJoin("variants as v", "v.id", "l.variant_id").select(["l.id", "v.sku", "v.barcode"]).where("l.order_id", "=", order.id).orderBy("l.external_line_id").execute();
    const items = p.items.map((i) => {
      const line = i.lineId ? lines.find((l) => l.id === i.lineId) : i.barcode ? lines.find((l) => l.barcode === i.barcode) : lines.find((l) => l.sku === i.sku);
      if (!line) throw new Refused("rejected", "unknown_item", i.barcode ? `no item with barcode ${i.barcode} on this order` : i.sku ? `no item with SKU ${i.sku} on this order` : "no such line on this order");
      return { lineId: line.id, quantity: i.quantity, outcome: i.outcome };
    });
    const r = await this.returns.record(trx, tenantId, order.id, { items, ...(p.note ? { note: p.note } : {}) }, { type: "user", id: auth.user.id }, op.opId);
    return { orderId: order.id, inspected: r.items.length, complete: r.complete };
  }

  /** The item by id, else by barcode (what a scan reads), else by SKU. */
  private async variant(trx: Trx, p: { variantId?: string | undefined; barcode?: string | undefined; sku?: string | undefined }): Promise<string> {
    let q = trx.selectFrom("variants").select("id");
    q = p.variantId ? q.where("id", "=", p.variantId) : p.barcode ? q.where("barcode", "=", p.barcode) : q.where("sku", "=", p.sku!);
    const v = await q.executeTakeFirst();
    if (!v) throw new Refused("rejected", "unknown_item", p.barcode ? `no item with barcode ${p.barcode}` : p.sku ? `no item with SKU ${p.sku}` : "no such item");
    return v.id;
  }
}

class Refused extends Error {
  readonly outcome: Outcome;
  constructor(status: Stored, code: string, message: string) {
    super(message);
    this.outcome = { status, code, message, result: null };
  }
}

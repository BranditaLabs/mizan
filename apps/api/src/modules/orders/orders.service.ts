import { Inject, Injectable } from "@nestjs/common";
import { sql, type ExpressionBuilder, type Transaction } from "kysely";
import type { DB } from "@mizan/db";
import { fromMinor, normalizePhone } from "@mizan/shared";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { Database } from "../../platform/db/database.js";
import { ProblemError } from "../../platform/http/problem.js";
import { PiiCipher } from "../../platform/pii/pii-cipher.js";
import { phoneCountryOf } from "../../platform/pii/phone-country.js";
import { ORDER_STATUSES, type ListOrdersQuery, type OrderSummary } from "./orders.dto.js";

type Eb = ExpressionBuilder<DB & { o: DB["orders"] }, "o">;

/** Cursor = "<placed_at ISO>|<id>" (newest first, ties by id). */
const encode = (at: Date, id: string) => Buffer.from(`${at.toISOString()}|${id}`).toString("base64url");
function decode(cursor: string) {
  const [at, id] = Buffer.from(cursor, "base64url").toString().split("|");
  const d = new Date(at ?? "");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id) || Number.isNaN(d.getTime())) throw new ProblemError(422, "validation_failed", "cursor is not valid", [{ path: "cursor", code: "invalid" }]);
  return { at: d, id };
}
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * M1 order list (E5-1). Role scope: agents see orders assigned to them, warehouse sees confirmed
 * and shipped orders; owner, admin, ops manager and finance see all. Search never decrypts:
 * order numbers by prefix, store ids exactly, phones by their keyed hash. The row's customer label
 * ("Mona A.") is the only personal data decrypted for a list.
 */
@Injectable()
export class OrdersService {
  constructor(@Inject(Database) private readonly db: Database, @Inject(PiiCipher) private readonly cipher: PiiCipher) {}

  async list(auth: AuthContext, q: ListOrdersQuery) {
    const tenantId = auth.tenant!.id;
    const after = q.cursor ? decode(q.cursor) : null;
    return this.db.tenant(tenantId, async (trx) => {
      const scope = await this.scope(trx, auth, q);
      let rows = trx.selectFrom("orders as o").leftJoin("connections as c", "c.id", "o.connection_id")
        .select(["o.id", "o.number", "o.status", "o.channel", "o.connection_id", "c.provider", "o.customer_label", "o.phone_last4", "o.total_minor", "o.cod_minor",
          "o.currency", "o.payment_mode", "o.payment_status", "o.risk_score", "o.tags", "o.placed_at"])
        .where(scope).orderBy("o.placed_at", "desc").orderBy("o.id", "desc").limit(q.limit + 1);
      if (q.status) rows = rows.where("o.status", "=", q.status);
      if (after) rows = rows.where((eb) => eb.or([eb("o.placed_at", "<", after.at), eb.and([eb("o.placed_at", "=", after.at), eb("o.id", "<", after.id)])]));
      const found = await rows.execute();
      const counts = await trx.selectFrom("orders as o").where(scope).select(["o.status", sql<string>`count(*)`.as("n")]).groupBy("o.status").execute();

      const page = found.slice(0, q.limit);
      const pii = page.some((r) => r.customer_label) ? await this.cipher.forTenant(trx, tenantId) : null;
      const byStatus = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0])) as Record<(typeof ORDER_STATUSES)[number], number>;
      for (const c of counts) byStatus[c.status as keyof typeof byStatus] = Number(c.n);
      const last = page.at(-1);
      return {
        // status, channel and payment columns are TEXT with CHECK constraints (migrations 0001, 0002).
        data: page.map((r): OrderSummary => ({
          id: r.id, number: r.number, status: r.status as OrderSummary["status"], channel: r.channel,
          store: { connectionId: r.connection_id, provider: r.provider },
          customer: { label: pii?.decrypt(r.customer_label, "orders.customer_label") ?? null, phoneLast4: r.phone_last4 },
          total: fromMinor(BigInt(r.total_minor), r.currency), cod: fromMinor(BigInt(r.cod_minor), r.currency),
          paymentMode: r.payment_mode as OrderSummary["paymentMode"], paymentStatus: r.payment_status as OrderSummary["paymentStatus"],
          risk: r.risk_score, tags: r.tags, placedAt: r.placed_at.toISOString(),
        })),
        nextCursor: found.length > q.limit && last ? encode(last.placed_at, last.id) : null,
        counts: { all: Object.values(byStatus).reduce((a, b) => a + b, 0), ...byStatus },
      };
    });
  }

  /** Everything but the status filter (the tabs count across statuses). */
  private async scope(trx: Transaction<DB>, auth: AuthContext, q: ListOrdersQuery) {
    const role = auth.tenant!.role;
    let phoneHash: string | null = null;
    if (q.q) {
      const phone = normalizePhone(q.q, await phoneCountryOf(trx, auth.tenant!.id));
      if (phone) phoneHash = (await this.cipher.forTenant(trx, auth.tenant!.id)).phoneHash(phone.e164);
    }
    return (eb: Eb) => {
      const and = [];
      if (role === "agent") and.push(eb("o.assigned_to", "=", auth.user.id));
      if (role === "warehouse") and.push(eb("o.status", "in", ["confirmed", "shipped"]));
      if (q.paymentMode) and.push(eb("o.payment_mode", "=", q.paymentMode));
      if (q.connectionId) and.push(eb("o.connection_id", "=", q.connectionId));
      if (q.from) and.push(eb("o.placed_at", ">=", new Date(q.from)));
      if (q.to) and.push(eb("o.placed_at", "<", new Date(q.to)));
      if (q.q) {
        const n = likeEscape(q.q.replace(/^#/, "").toLowerCase());
        const any = [
          eb(sql`lower(o.number)`, "like", `${n}%`), eb(sql`lower(o.number)`, "like", `#${n}%`), eb("o.external_id", "=", q.q),
        ];
        if (phoneHash) any.push(eb("o.customer_id", "in", eb.selectFrom("customers").select("id").where("phone_hash", "=", phoneHash)));
        and.push(eb.or(any));
      }
      return eb.and(and);
    };
  }
}

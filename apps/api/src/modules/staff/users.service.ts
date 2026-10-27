import { Inject, Injectable } from "@nestjs/common";
import { sql, type ExpressionBuilder, type Transaction } from "kysely";
import type { DB } from "@mizan/db";
import type { z } from "zod";
import { AuditService } from "../../platform/audit/audit.service.js";
import { AuthService } from "../../platform/auth/auth.service.js";
import type { AuthContext, StaffRole } from "../../platform/auth/auth.types.js";
import { Database } from "../../platform/db/database.js";
import { ProblemError } from "../../platform/http/problem.js";
import type { UserDetailSchema, UsersQuerySchema } from "./users.dto.js";

type Trx = Transaction<DB>;
type Row = { id: string; email: string | null; phone_e164: string | null; display_name: string | null; created_at: Date; disabled_at: Date | null; disabled_reason: string | null; stores: string | number; staff_role: string | null };

/**
 * People in the back office (A-5): find a Mizan user, see their stores, stop or allow their sign-in.
 * Disabling a user refuses every API request they make (AuthService) and is written to the audit
 * log of every store they belong to. Staff are managed in /platform/staff (A-1); a staff member's
 * staff access must be disabled before their sign-in.
 */
@Injectable()
export class UsersService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  async search(q: z.output<typeof UsersQuerySchema>) {
    const term = q.q?.toLowerCase();
    const cond = (eb: ExpressionBuilder<DB & { u: DB["users"] }, "u">) => {
      const all = [];
      if (term) {
        const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        const digits = term.replace(/[^\d]/g, "");
        all.push(eb.or([
          eb(eb.fn("lower", ["u.email"]), "like", like),
          eb("u.display_name", "ilike", like),
          eb(sql<string>`u.id::text`, "=", term),
          ...(digits.length >= 6 ? [eb("u.phone_e164", "like", `%${digits}%`)] : []),
        ]));
      }
      if (q.disabled !== undefined) all.push(eb("u.disabled_at", q.disabled ? "is not" : "is", null));
      return eb.and(all);
    };
    return this.db.staff(async (trx) => {
      const total = Number((await trx.selectFrom("users as u").where(cond).select((eb) => eb.fn.countAll<string>().as("n")).executeTakeFirstOrThrow()).n);
      const rows = await this.query(trx).where(cond).orderBy("u.created_at", "desc").orderBy("u.id").limit(q.limit + 1).offset(q.offset).execute();
      return { data: rows.slice(0, q.limit).map(view), total, nextOffset: rows.length > q.limit ? q.offset + q.limit : null };
    });
  }

  async detail(id: string): Promise<z.output<typeof UserDetailSchema>> {
    return this.db.staff(async (trx) => {
      const row = await this.query(trx).where("u.id", "=", id).executeTakeFirst();
      if (!row) throw new ProblemError(404, "not_found", "no such user");
      const memberships = await trx.selectFrom("memberships as m").innerJoin("tenants as t", "t.id", "m.tenant_id")
        .select(["m.tenant_id", "t.name", "t.status as store_status", "m.role", "m.status", "m.created_at"]).where("m.user_id", "=", id).orderBy("m.created_at").execute();
      return {
        ...view(row),
        memberships: memberships.map((m) => ({ storeId: m.tenant_id, storeName: m.name, storeStatus: m.store_status, role: m.role, status: m.status, joinedAt: m.created_at.toISOString() })),
      };
    });
  }

  async disable(auth: AuthContext, id: string, reason: string) {
    if (id === auth.user.id) throw new ProblemError(409, "not_yourself", "you cannot disable your own sign-in");
    return this.set(auth, id, async (trx, u) => {
      const staff = await trx.selectFrom("platform_staff").select("status").where("user_id", "=", id).executeTakeFirst();
      if (staff?.status === "active") throw new ProblemError(409, "user_is_staff", "disable their staff access first");
      if (u.disabled_at) return null;
      return { disabled_at: new Date(), disabled_reason: reason };
    }, "user.sign_in_disabled", reason);
  }

  async enable(auth: AuthContext, id: string) {
    return this.set(auth, id, async (_trx, u) => (u.disabled_at ? { disabled_at: null, disabled_reason: null } : null), "user.sign_in_enabled");
  }

  private async set(auth: AuthContext, id: string, next: (trx: Trx, u: { disabled_at: Date | null; firebase_uid: string }) => Promise<{ disabled_at: Date | null; disabled_reason: string | null } | null>,
    action: "user.sign_in_disabled" | "user.sign_in_enabled", reason?: string) {
    const uid = await this.db.staff(async (trx) => {
      const u = await trx.selectFrom("users").select(["id", "firebase_uid", "disabled_at"]).where("id", "=", id).forUpdate().executeTakeFirst();
      if (!u) throw new ProblemError(404, "not_found", "no such user");
      const set = await next(trx, u);
      if (!set) return u.firebase_uid;
      await trx.updateTable("users").set(set).where("id", "=", id).execute();
      // Every store the person belongs to sees it: they may be the reason the store's data was safe.
      const stores = await trx.selectFrom("memberships").select("tenant_id").where("user_id", "=", id).execute();
      for (const s of stores) {
        await this.audit.record(trx, {
          action, tenantId: s.tenant_id, actor: { type: "mizan_staff", id: auth.staff!.id }, entity: { type: "user", id },
          ...(reason ? { after: { reason } } : {}),
        });
      }
      return u.firebase_uid;
    });
    this.auth.forgetUser(uid);
    return this.detail(id);
  }

  private query(trx: Trx) {
    return trx.selectFrom("users as u").select([
      "u.id", "u.email", "u.phone_e164", "u.display_name", "u.created_at", "u.disabled_at", "u.disabled_reason",
      sql<string>`(SELECT count(*) FROM memberships m WHERE m.user_id = u.id)`.as("stores"),
      sql<string | null>`(SELECT s.role FROM platform_staff s WHERE s.user_id = u.id AND s.status = 'active')`.as("staff_role"),
    ]);
  }
}

const view = (r: Row) => ({
  id: r.id, email: r.email, phone: r.phone_e164, name: r.display_name, createdAt: r.created_at.toISOString(),
  disabled: r.disabled_at ? { at: r.disabled_at.toISOString(), reason: r.disabled_reason ?? "" } : null,
  stores: Number(r.stores), staffRole: (r.staff_role as StaffRole | null) ?? null,
});

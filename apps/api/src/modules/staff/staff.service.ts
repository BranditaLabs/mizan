import { Inject, Injectable, Logger } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import type { DB } from "@mizan/db";
import type { AuthContext, StaffRole } from "../../platform/auth/auth.types.js";
import { APP_CONFIG, type AppConfig } from "../../platform/config.js";
import { Database } from "../../platform/db/database.js";
import { ProblemError } from "../../platform/http/problem.js";

type Trx = Transaction<DB>;
export interface AuditLine {
  staffId?: string | null; userId?: string | null; action: string; outcome: "ok" | "denied" | "failed"; status?: number;
  targetType?: string; targetId?: string; storeId?: string; ip?: string; data?: Record<string, unknown>;
}
export interface StaffView { id: string; userId: string; email: string | null; name: string | null; role: StaffRole; status: "active" | "disabled"; createdAt: string }

/**
 * Mizan staff (A-1): who they are, their role, and the trail of everything they do. Runs as the
 * back office's role; the app role cannot read any of it. The first super admin comes from
 * PLATFORM_BOOTSTRAP_EMAILS (a verified email, recorded); everyone else is added by a super admin.
 */
@Injectable()
export class StaffService {
  private readonly log = new Logger("Staff");
  private readonly bootstrap: ReadonlySet<string>;

  constructor(@Inject(Database) private readonly db: Database, @Inject(APP_CONFIG) config: AppConfig) {
    this.bootstrap = new Set((config.PLATFORM_BOOTSTRAP_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean));
  }

  /** The caller's staff record, bootstrapping a configured first super admin. Null for everyone else. */
  async resolve(auth: AuthContext): Promise<{ id: string; role: StaffRole; status: string } | null> {
    return this.db.staff(async (trx) => {
      const row = await trx.selectFrom("platform_staff").select(["id", "role", "status"]).where("user_id", "=", auth.user.id).executeTakeFirst();
      if (row) return { id: row.id, role: row.role as StaffRole, status: row.status };
      const email = auth.identity.email?.toLowerCase();
      if (!email || !auth.identity.emailVerified || !this.bootstrap.has(email)) return null;
      const created = await trx.insertInto("platform_staff").values({ user_id: auth.user.id, role: "super_admin" })
        .onConflict((oc) => oc.column("user_id").doNothing()).returning(["id", "role", "status"]).executeTakeFirst();
      const staff = created ?? await trx.selectFrom("platform_staff").select(["id", "role", "status"]).where("user_id", "=", auth.user.id).executeTakeFirstOrThrow();
      await this.write(trx, { staffId: staff.id, userId: auth.user.id, action: "staff.bootstrapped", outcome: "ok", targetType: "staff", targetId: staff.id, ...(auth.ip ? { ip: auth.ip } : {}) });
      this.log.warn({ staffId: staff.id }, "first super admin bootstrapped from PLATFORM_BOOTSTRAP_EMAILS");
      return { id: staff.id, role: staff.role as StaffRole, status: staff.status };
    });
  }

  /** One line in the staff trail (append-only). */
  audit(line: AuditLine): Promise<void> {
    return this.db.staff((trx) => this.write(trx, line));
  }

  async list(): Promise<StaffView[]> {
    return this.db.staff(async (trx) => (await this.rows(trx)).map(view));
  }

  async add(auth: AuthContext, body: { email: string; role: StaffRole }): Promise<StaffView> {
    return this.db.staff(async (trx) => {
      const user = await trx.selectFrom("users").select("id").where((eb) => eb(eb.fn("lower", ["email"]), "=", body.email.toLowerCase())).executeTakeFirst();
      if (!user) throw new ProblemError(404, "user_not_found", "the person must sign in to Mizan once first");
      const exists = await trx.selectFrom("platform_staff").select("id").where("user_id", "=", user.id).executeTakeFirst();
      if (exists) throw new ProblemError(409, "already_staff", "already on the staff");
      const row = await trx.insertInto("platform_staff").values({ user_id: user.id, role: body.role, added_by: auth.staff!.id }).returning("id").executeTakeFirstOrThrow();
      await this.write(trx, { staffId: auth.staff!.id, userId: auth.user.id, action: "staff.added", outcome: "ok", targetType: "staff", targetId: row.id, data: { role: body.role }, ...(auth.ip ? { ip: auth.ip } : {}) });
      return view((await this.rows(trx, row.id))[0]!);
    });
  }

  async update(auth: AuthContext, id: string, body: { role?: StaffRole | undefined; status?: "active" | "disabled" | undefined }): Promise<StaffView> {
    return this.db.staff(async (trx) => {
      const s = await trx.selectFrom("platform_staff").select(["id", "role", "status"]).where("id", "=", id).forUpdate().executeTakeFirst();
      if (!s) throw new ProblemError(404, "not_found", "no such staff member");
      const next = { role: body.role ?? s.role, status: body.status ?? s.status };
      // Mizan always keeps an active super admin (and nobody locks themselves out by mistake).
      if (s.role === "super_admin" && s.status === "active" && (next.role !== "super_admin" || next.status !== "active")) {
        const others = await trx.selectFrom("platform_staff").select("id").where("role", "=", "super_admin").where("status", "=", "active").where("id", "!=", id).execute();
        if (!others.length) throw new ProblemError(409, "last_super_admin", "Mizan needs at least one active super admin");
      }
      await trx.updateTable("platform_staff").set({ role: next.role, status: next.status, updated_at: new Date() }).where("id", "=", id).execute();
      await this.write(trx, { staffId: auth.staff!.id, userId: auth.user.id, action: "staff.updated", outcome: "ok", targetType: "staff", targetId: id, data: { before: { role: s.role, status: s.status }, after: next }, ...(auth.ip ? { ip: auth.ip } : {}) });
      return view((await this.rows(trx, id))[0]!);
    });
  }

  async trail(limit: number, before?: number) {
    return this.db.staff(async (trx) => {
      let q = trx.selectFrom("platform_audit as a").leftJoin("users as u", "u.id", "a.user_id")
        .select(["a.id", "a.staff_id", "a.action", "a.outcome", "a.status", "a.target_type", "a.target_id", "a.store_id", "a.created_at", "u.email"])
        .orderBy("a.id", "desc").limit(limit + 1);
      if (before) q = q.where(sql<boolean>`a.id < ${before}`);
      const rows = await q.execute();
      const page = rows.slice(0, limit);
      return {
        data: page.map((r) => ({ id: Number(r.id), staffId: r.staff_id, email: r.email, action: r.action, outcome: r.outcome as "ok", status: r.status, target: r.target_type ? { type: r.target_type, id: r.target_id } : null, storeId: r.store_id, at: r.created_at.toISOString() })),
        nextBefore: rows.length > limit ? Number(page.at(-1)!.id) : null,
      };
    });
  }

  private rows(trx: Trx, id?: string) {
    let q = trx.selectFrom("platform_staff as s").innerJoin("users as u", "u.id", "s.user_id")
      .select(["s.id", "s.user_id", "s.role", "s.status", "s.created_at", "u.email", "u.display_name"]).orderBy("s.created_at");
    if (id) q = q.where("s.id", "=", id);
    return q.execute();
  }

  private async write(trx: Trx, l: AuditLine) {
    await trx.insertInto("platform_audit").values({
      staff_id: l.staffId ?? null, user_id: l.userId ?? null, action: l.action.slice(0, 200), outcome: l.outcome, status: l.status ?? null,
      target_type: l.targetType ?? null, target_id: l.targetId ?? null, store_id: l.storeId ?? null, ip: l.ip ?? null, data: l.data ? JSON.stringify(l.data) : null,
    }).execute();
  }
}

const view = (r: { id: string; user_id: string; role: string; status: string; created_at: Date; email: string | null; display_name: string | null }): StaffView => ({
  id: r.id, userId: r.user_id, email: r.email, name: r.display_name, role: r.role as StaffRole, status: r.status as "active", createdAt: r.created_at.toISOString(),
});

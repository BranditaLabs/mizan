import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "../../platform/audit/audit.service.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { Database } from "../../platform/db/database.js";
import { ProblemError } from "../../platform/http/problem.js";

/**
 * Support access (A-3): just-in-time, with a reason and an expiry; read-only unless a super admin
 * opens it for writing. The store sees it while it is open (banner) and always in its audit log,
 * and may end it early. The guard checks the grant on every request, so expiry is exact.
 */
@Injectable()
export class SupportAccessService {
  constructor(@Inject(Database) private readonly db: Database, @Inject(AuditService) private readonly audit: AuditService) {}

  async open(auth: AuthContext, storeId: string, body: { reason: string; minutes: number; mode: "read" | "write" }) {
    if (body.mode === "write" && auth.staff!.role !== "super_admin") throw new ProblemError(403, "insufficient_role", "write access needs a super admin");
    return this.db.staff(async (trx) => {
      const t = await trx.selectFrom("tenants").select(["id", "name", "status"]).where("id", "=", storeId).executeTakeFirst();
      if (!t) throw new ProblemError(404, "not_found", "no such store");
      if (t.status === "deleted") throw new ProblemError(409, "store_deleted", "this store was deleted");
      const now = new Date();
      const open = await trx.selectFrom("support_access").select("id").where("tenant_id", "=", storeId).where("staff_id", "=", auth.staff!.id)
        .where("ended_at", "is", null).where("expires_at", ">", now).executeTakeFirst();
      if (open) throw new ProblemError(409, "access_open", "you already have access to this store; end it first");
      const expiresAt = new Date(now.getTime() + body.minutes * 60_000);
      const row = await trx.insertInto("support_access").values({ tenant_id: storeId, staff_id: auth.staff!.id, mode: body.mode, reason: body.reason, expires_at: expiresAt, created_at: now })
        .returning(["id", "mode", "reason", "created_at", "expires_at"]).executeTakeFirstOrThrow();
      await this.audit.record(trx, {
        action: "support.access_started", tenantId: storeId, actor: { type: "mizan_staff", id: auth.staff!.id }, entity: { type: "support_access", id: row.id },
        after: { mode: row.mode, reason: row.reason, expiresAt: row.expires_at.toISOString() },
      });
      return { id: row.id, storeId, storeName: t.name, mode: row.mode as "read", reason: row.reason, startedAt: row.created_at.toISOString(), expiresAt: row.expires_at.toISOString() };
    });
  }

  /** The caller ends their own open access to a store. */
  async endMine(auth: AuthContext, storeId: string) {
    return this.db.staff(async (trx) => {
      const ended = await trx.updateTable("support_access").set({ ended_at: new Date(), ended_by: "staff" })
        .where("tenant_id", "=", storeId).where("staff_id", "=", auth.staff!.id).where("ended_at", "is", null).where("expires_at", ">", new Date())
        .returning("id").execute();
      if (!ended.length) throw new ProblemError(404, "not_found", "you have no open access to this store");
      for (const g of ended) {
        await this.audit.record(trx, { action: "support.access_ended", tenantId: storeId, actor: { type: "mizan_staff", id: auth.staff!.id }, entity: { type: "support_access", id: g.id }, after: { by: "staff" } });
      }
      return { ended: ended.length };
    });
  }

  /** The caller's open grants, soonest to end first. */
  async mine(auth: AuthContext) {
    return this.db.staff(async (trx) => {
      const rows = await trx.selectFrom("support_access as a").innerJoin("tenants as t", "t.id", "a.tenant_id")
        .select(["a.id", "a.tenant_id", "t.name", "a.mode", "a.reason", "a.created_at", "a.expires_at"])
        .where("a.staff_id", "=", auth.staff!.id).where("a.ended_at", "is", null).where("a.expires_at", ">", new Date()).orderBy("a.expires_at").execute();
      return { data: rows.map((r) => ({ id: r.id, storeId: r.tenant_id, storeName: r.name, mode: r.mode as "read", reason: r.reason, startedAt: r.created_at.toISOString(), expiresAt: r.expires_at.toISOString() })) };
    });
  }

  /** What the store sees: Mizan support that is in right now. */
  async forStore(auth: AuthContext) {
    return this.db.tenant(auth.tenant!.id, async (trx) => {
      const rows = await trx.selectFrom("support_access").select(["id", "mode", "reason", "created_at", "expires_at"])
        .where("ended_at", "is", null).where("expires_at", ">", new Date()).orderBy("expires_at").execute();
      return { data: rows.map((r) => ({ id: r.id, mode: r.mode as "read", reason: r.reason, startedAt: r.created_at.toISOString(), expiresAt: r.expires_at.toISOString() })) };
    });
  }

  /** The store ends a grant early (owner, admin). Ending one that already ended is a no-op. */
  async endForStore(auth: AuthContext, id: string) {
    return this.db.tenant(auth.tenant!.id, async (trx) => {
      const g = await trx.selectFrom("support_access").select(["id", "ended_at", "expires_at"]).where("id", "=", id).executeTakeFirst();
      if (!g) throw new ProblemError(404, "not_found", "no such support access");
      if (g.ended_at || g.expires_at <= new Date()) return { ended: 0 };
      await trx.updateTable("support_access").set({ ended_at: new Date(), ended_by: "store", ended_by_user: auth.user.id }).where("id", "=", id).execute();
      await this.audit.record(trx, { action: "support.access_ended", tenantId: auth.tenant!.id, actor: { type: "user", id: auth.user.id }, entity: { type: "support_access", id }, after: { by: "store" }, ...(auth.ip ? { ip: auth.ip } : {}) });
      return { ended: 1 };
    });
  }
}

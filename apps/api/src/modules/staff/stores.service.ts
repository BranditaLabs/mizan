import { Inject, Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import type { z } from "zod";
import type { DB } from "@mizan/db";
import { AuditService } from "../../platform/audit/audit.service.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { AuthService } from "../../platform/auth/auth.service.js";
import { Database } from "../../platform/db/database.js";
import { ProblemError } from "../../platform/http/problem.js";
import { scrubText } from "../../platform/logging/redact.js";
import type { Plan } from "../billing/plans.js";
import type { StoreDetailSchema, StoresQuerySchema } from "./stores.dto.js";

type Trx = Transaction<DB>;
type Query = z.output<typeof StoresQuerySchema>;
type Status = "trial" | "active" | "suspended" | "deleted";
type UsageRow = { month: Date | string; orders: number; whatsapp_messages: number; ai_offers: number; plan: string };

/**
 * Stores in the back office (A-2): find a store, see its health, suspend / reactivate it, change
 * its plan, keep internal notes. Runs as the back office's role, which reads store metadata, never
 * orders or customers. Every change is also written to the store's own audit log as "mizan_staff",
 * so the merchant sees what Mizan did; the staff trail records the call itself.
 */
@Injectable()
export class StoresService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  async list(q: Query) {
    return this.db.staff(async (trx) => {
      let base = trx.selectFrom("tenants as t");
      if (q.q) {
        const like = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        base = base.where((eb) => eb.or([eb("t.name", "ilike", like), eb("t.slug", "ilike", like), eb(sql<string>`t.id::text`, "=", q.q!.toLowerCase())]));
      }
      if (q.plan) base = base.where("t.plan", "=", q.plan);
      if (q.status) base = base.where("t.status", "=", q.status);
      else base = base.where("t.status", "!=", "deleted");
      if (q.country) base = base.where("t.country", "=", q.country);
      if (q.createdFrom) base = base.where("t.created_at", ">=", new Date(`${q.createdFrom}T00:00:00Z`));
      if (q.createdTo) base = base.where(sql<boolean>`t.created_at < (${q.createdTo}::date + 1)`);

      const total = Number((await base.select((eb) => eb.fn.countAll<string>().as("n")).executeTakeFirstOrThrow()).n);
      const lastOrders = sql<number>`(SELECT u.orders FROM usage_months u WHERE u.tenant_id = t.id ORDER BY u.month DESC LIMIT 1)`;
      let rows = base.select(["t.id", "t.name", "t.slug", "t.country", "t.plan", "t.status", "t.created_at"]).limit(q.limit + 1).offset(q.offset);
      rows = q.sort === "orders" ? rows.orderBy(sql`${lastOrders} DESC NULLS LAST`).orderBy("t.created_at", "desc") : rows.orderBy("t.created_at", "desc").orderBy("t.id");
      const page = await rows.execute();
      const shown = page.slice(0, q.limit);
      const facts = await this.facts(trx, shown.map((r) => r.id));
      return {
        data: shown.map((r) => ({ ...summary(r), ...facts(r.id) })),
        total,
        nextOffset: page.length > q.limit ? q.offset + q.limit : null,
      };
    });
  }

  async detail(storeId: string): Promise<z.output<typeof StoreDetailSchema>> {
    return this.db.staff(async (trx) => {
      const t = await trx.selectFrom("tenants").select(["id", "name", "slug", "country", "plan", "status", "created_at", "updated_at", "base_currency", "timezone"])
        .where("id", "=", storeId).executeTakeFirst();
      if (!t) throw new ProblemError(404, "not_found", "no such store");
      const [facts, team, integrations, outbox, oldest, dead, usage, notes] = await Promise.all([
        this.facts(trx, [t.id]),
        trx.selectFrom("memberships as m").innerJoin("users as u", "u.id", "m.user_id")
          .select(["m.user_id", "u.email", "u.display_name", "m.role", "m.status", "m.created_at"]).where("m.tenant_id", "=", t.id).orderBy("m.created_at").execute(),
        trx.selectFrom("connections").select(["id", "kind", "provider", "external_account", "display_name", "status", "status_reason", "updated_at"])
          .where("tenant_id", "=", t.id).orderBy("created_at").execute(),
        trx.selectFrom("mz_outbox").select(["status", (eb) => eb.fn.countAll<string>().as("n")]).where("tenant_id", "=", t.id)
          .where("status", "in", ["pending", "running", "dead"]).groupBy("status").execute(),
        trx.selectFrom("mz_outbox").select((eb) => eb.fn.min("created_at").as("at")).where("tenant_id", "=", t.id).where("status", "=", "pending").executeTakeFirst(),
        trx.selectFrom("mz_outbox").select(["id", "kind", "connection", "attempts", "last_error", "updated_at"])
          .where("tenant_id", "=", t.id).where("status", "=", "dead").orderBy("updated_at", "desc").limit(20).execute(),
        trx.selectFrom("usage_months").select(["month", "orders", "whatsapp_messages", "ai_offers", "plan"]).where("tenant_id", "=", t.id).orderBy("month", "desc").limit(12).execute(),
        this.notes(trx, t.id),
      ]);
      const count = (s: string) => Number(outbox.find((o) => o.status === s)?.n ?? 0);
      return {
        ...summary(t), ...facts(t.id),
        currency: t.base_currency, timezone: t.timezone, updatedAt: t.updated_at.toISOString(),
        team: team.map((m) => ({ userId: m.user_id, email: m.email, name: m.display_name, role: m.role, status: m.status, joinedAt: m.created_at.toISOString() })),
        integrations: integrations.map((c) => ({ id: c.id, kind: c.kind, provider: c.provider, account: c.external_account, name: c.display_name, status: c.status, reason: c.status_reason, updatedAt: c.updated_at.toISOString() })),
        outbox: { pending: count("pending"), running: count("running"), dead: count("dead"), oldestPendingAt: oldest?.at != null ? new Date(Number(oldest.at)).toISOString() : null },
        deadLetters: dead.map((j) => ({ id: j.id, kind: j.kind, provider: j.connection, attempts: Number(j.attempts), error: j.last_error ? scrubText(j.last_error).slice(0, 300) : null, failedAt: new Date(Number(j.updated_at)).toISOString() })),
        usage: usage.map(usageView),
        notes,
      };
    });
  }

  suspend(auth: AuthContext, storeId: string, reason: string) {
    return this.change(auth, storeId, "store.suspended", (t) => {
      if (t.status === "deleted") throw new ProblemError(409, "store_deleted", "this store was deleted");
      if (t.status === "suspended") throw new ProblemError(409, "already_suspended", "this store is already suspended");
      return { status: "suspended" };
    }, reason);
  }

  reactivate(auth: AuthContext, storeId: string, reason?: string) {
    return this.change(auth, storeId, "store.reactivated", (t) => {
      if (t.status !== "suspended") throw new ProblemError(409, "not_suspended", "only a suspended store can be reactivated");
      return { status: "active" };
    }, reason);
  }

  changePlan(auth: AuthContext, storeId: string, plan: Plan, reason?: string) {
    return this.change(auth, storeId, "store.plan_changed", (t) => {
      if (t.status === "deleted") throw new ProblemError(409, "store_deleted", "this store was deleted");
      return t.plan === plan ? null : { plan };
    }, reason);
  }

  async addNote(auth: AuthContext, storeId: string, body: string) {
    return this.db.staff(async (trx) => {
      await this.store(trx, storeId);
      const row = await trx.insertInto("platform_store_notes").values({ store_id: storeId, staff_id: auth.staff!.id, body }).returning(["id", "body", "created_at"]).executeTakeFirstOrThrow();
      return { id: row.id, body: row.body, by: auth.user.email, at: row.created_at.toISOString() };
    });
  }

  /** One staff change to a store: lock it, apply, and write it to the store's own audit log. null = nothing to change. */
  private async change(auth: AuthContext, storeId: string, action: "store.suspended" | "store.reactivated" | "store.plan_changed",
    next: (t: { plan: string; status: string }) => { status?: Status; plan?: Plan } | null, reason?: string) {
    const out = await this.db.staff(async (trx) => {
      const t = await this.store(trx, storeId, true);
      const set = next(t);
      if (!set) return { id: t.id, plan: t.plan as Plan, status: t.status as Status, updatedAt: t.updated_at.toISOString() };
      const row = await trx.updateTable("tenants").set({ ...set, updated_at: new Date() }).where("id", "=", storeId)
        .returning(["id", "plan", "status", "updated_at"]).executeTakeFirstOrThrow();
      const keys = Object.keys(set) as ("status" | "plan")[];
      await this.audit.record(trx, {
        action, tenantId: storeId, actor: { type: "mizan_staff", id: auth.staff!.id }, entity: { type: "store", id: storeId },
        before: Object.fromEntries(keys.map((k) => [k, t[k]])), after: { ...set, ...(reason ? { reason } : {}) },
      });
      return { id: row.id, plan: row.plan as Plan, status: row.status as Status, updatedAt: row.updated_at.toISOString() };
    });
    // Members are refused (or let back in) at once on this instance; other instances follow within the membership cache TTL.
    this.auth.invalidateMembership(storeId);
    return out;
  }

  private async store(trx: Trx, id: string, lock = false) {
    let q = trx.selectFrom("tenants").select(["id", "plan", "status", "updated_at"]).where("id", "=", id);
    if (lock) q = q.forUpdate();
    const t = await q.executeTakeFirst();
    if (!t) throw new ProblemError(404, "not_found", "no such store");
    return t;
  }

  private async notes(trx: Trx, storeId: string) {
    const rows = await trx.selectFrom("platform_store_notes as n").leftJoin("platform_staff as s", "s.id", "n.staff_id").leftJoin("users as u", "u.id", "s.user_id")
      .select(["n.id", "n.body", "n.created_at", "u.email"]).where("n.store_id", "=", storeId).orderBy("n.created_at", "desc").limit(50).execute();
    return rows.map((n) => ({ id: n.id, body: n.body, by: n.email, at: n.created_at.toISOString() }));
  }

  /** Members, connections and last closed month for a page of stores, in three queries. */
  private async facts(trx: Trx, ids: string[]) {
    if (!ids.length) return () => ({ members: 0, connections: { total: 0, needsAttention: 0 }, lastMonth: null });
    const [members, conns, usage] = await Promise.all([
      trx.selectFrom("memberships").select(["tenant_id", (eb) => eb.fn.countAll<string>().as("n")]).where("tenant_id", "in", ids).where("status", "=", "active").groupBy("tenant_id").execute(),
      trx.selectFrom("connections").select(["tenant_id", (eb) => eb.fn.countAll<string>().as("n"), sql<string>`count(*) FILTER (WHERE status = 'needs_attention')`.as("bad")])
        .where("tenant_id", "in", ids).where("status", "!=", "disconnected").groupBy("tenant_id").execute(),
      trx.selectFrom("usage_months").distinctOn("tenant_id").select(["tenant_id", "month", "orders", "whatsapp_messages", "ai_offers", "plan"])
        .where("tenant_id", "in", ids).orderBy("tenant_id").orderBy("month", "desc").execute(),
    ]);
    return (id: string) => {
      const c = conns.find((r) => r.tenant_id === id);
      const u = usage.find((r) => r.tenant_id === id);
      return {
        members: Number(members.find((r) => r.tenant_id === id)?.n ?? 0),
        connections: { total: Number(c?.n ?? 0), needsAttention: Number(c?.bad ?? 0) },
        lastMonth: u ? usageView(u) : null,
      };
    };
  }
}

const summary = (t: { id: string; name: string; slug: string; country: string; plan: string; status: string; created_at: Date }) => ({
  id: t.id, name: t.name, slug: t.slug, country: t.country, plan: t.plan as Plan, status: t.status as Status, createdAt: t.created_at.toISOString(),
});
const usageView = (u: UsageRow) => ({
  month: typeof u.month === "string" ? u.month.slice(0, 10) : u.month.toISOString().slice(0, 10),
  orders: Number(u.orders), whatsappMessages: Number(u.whatsapp_messages), aiOffers: Number(u.ai_offers), plan: u.plan,
});

import { Inject, Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";
import type { DB } from "@mizan/db";
import { afterConfirmationSettings, AfterConfirmationSchema, recommendedAfter, type AfterConfirmation, type MemberRole } from "@mizan/shared";
import { AuditService, auditActor } from "../../../platform/audit/audit.service.js";
import type { AuthContext } from "../../../platform/auth/auth.types.js";
import { APP_CONFIG, type AppConfig } from "../../../platform/config.js";
import { Database } from "../../../platform/db/database.js";
import { ProblemError } from "../../../platform/http/problem.js";
import { autoBookIntent } from "./decide.js";
import { NOTICE_SOURCE } from "./notices.js";

type Trx = Transaction<DB>;
export type Lang = "ar" | "en";

/**
 * What happens after confirmation (E6-23a): the store's settings, the follow-up a confirmation
 * leaves (hold for the grace window, then release and maybe book), and the team's Release now /
 * Book by hand. The work that reacts to outcomes is in AfterConfirmationConsumer; the follow-ups
 * fire in FollowupsRunner; booking itself is shipping's (AutoBookConsumer, rule 14).
 */
@Injectable()
export class AfterConfirmationService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async settingsOf(trx: Trx, tenantId: string): Promise<{ settings: AfterConfirmation; lang: Lang }> {
    const t = await trx.selectFrom("tenants").select(["settings", "locale"]).where("id", "=", tenantId).executeTakeFirstOrThrow();
    return { settings: afterConfirmationSettings(t.settings), lang: t.locale?.startsWith("en") ? "en" : "ar" };
  }

  /**
   * In the confirmation's own transaction, so a pick list or the ready-to-ship list can never take
   * the order before the hold is on. With the defaults (no grace, no auto-book) nothing is written.
   */
  async onConfirmed(trx: Trx, tenantId: string, orderId: string, runId: string | null, channel: string, now: Date): Promise<void> {
    if (channel === "exchange") return;
    const { settings } = await this.settingsOf(trx, tenantId);
    const changed = Boolean(await trx.selectFrom("confirmations").select("id").where("order_id", "=", orderId).where("outcome", "=", "changed").executeTakeFirst());
    const book = autoBookIntent(settings, channel, changed);
    const grace = settings.confirmed.graceMinutes;
    if (grace === 0 && !book) return;
    const runAt = new Date(now.getTime() + grace * 60_000);
    if (grace > 0) await trx.updateTable("orders").set({ held_until: runAt, hold_reason: "grace" }).where("id", "=", orderId).execute();
    const row = await trx.insertInto("order_followups").values({
      tenant_id: tenantId, order_id: orderId, run_id: runId, kind: "release", channel, changed, auto_book: book, run_at: runAt, idempotency_key: `release:${orderId}`,
    }).onConflict((oc) => oc.columns(["tenant_id", "idempotency_key"]).doNothing()).returning("id").executeTakeFirst();
    if (row) {
      await trx.insertInto("order_events").values({ tenant_id: tenantId, order_id: orderId, type: "after_confirmation_scheduled", actor_type: "system", data: JSON.stringify({ graceMinutes: grace, autoBook: book }) }).execute();
    }
  }

  /** A notice for the roles the store chose; once per key. */
  async notify(trx: Trx, tenantId: string, roles: MemberRole[], text: string, orderId: string, dedupeKey: string): Promise<void> {
    await trx.insertInto("notifications").values({ tenant_id: tenantId, roles, text, entity_type: "order", entity_id: orderId, source: NOTICE_SOURCE, dedupe_key: dedupeKey })
      .onConflict((oc) => oc.columns(["tenant_id", "dedupe_key"]).where("dedupe_key", "is not", null).doNothing()).execute();
  }

  // ───────────── settings (API) ─────────────

  async view(tenantId: string) {
    return this.db.tenant(tenantId, (trx) => this.viewIn(trx, tenantId));
  }

  private async viewIn(trx: Trx, tenantId: string) {
    const { settings } = await this.settingsOf(trx, tenantId);
    const couriers = await trx.selectFrom("connections").select(["id", "provider", "display_name", "external_account", "status"])
      .where("kind", "=", "courier").where("provider", "=", "bosta").where("status", "!=", "disconnected").orderBy("created_at").execute();
    const members = await trx.selectFrom("memberships as m").innerJoin("users as u", "u.id", "m.user_id")
      .select(["m.user_id", "m.role", "u.display_name", "u.email"]).where("m.status", "=", "active").orderBy("u.display_name").execute();
    // A courier disconnected or a member gone since: shown as "none", so a save never fails on it.
    const shown = structuredClone(settings);
    if (shown.confirmed.autoBook.courierConnectionId && !couriers.some((c) => c.id === shown.confirmed.autoBook.courierConnectionId)) shown.confirmed.autoBook.courierConnectionId = null;
    if (shown.changed.assignTo && !members.some((m) => m.user_id === shown.changed.assignTo)) shown.changed.assignTo = null;
    return {
      settings: shown,
      couriers: couriers.map((c) => ({ id: c.id, provider: c.provider, name: c.display_name ?? c.external_account ?? c.provider, status: c.status })),
      members: members.map((m) => ({ id: m.user_id, name: m.display_name ?? m.email ?? "", role: m.role })),
      recommended: recommendedAfter(couriers.length > 0),
    };
  }

  async put(auth: AuthContext, body: AfterConfirmation) {
    const tenantId = auth.tenant!.id;
    const next = AfterConfirmationSchema.parse(body);
    return this.db.tenant(tenantId, async (trx) => {
      const t = await trx.selectFrom("tenants").select("settings").where("id", "=", tenantId).forUpdate().executeTakeFirstOrThrow();
      await this.validate(trx, next);
      const before = afterConfirmationSettings(t.settings);
      await trx.updateTable("tenants").set({ settings: JSON.stringify({ ...(t.settings as object), afterConfirmation: next }) }).where("id", "=", tenantId).execute();
      await this.audit.record(trx, { action: "confirmation.after_settings_updated", tenantId, ...auditActor(auth), entity: { type: "tenant", id: tenantId }, before, after: next });
      return this.viewIn(trx, tenantId);
    });
  }

  /** What the schema cannot say: the courier and member exist here, no tag that would book through the engine, no tag both confirmed and cancelled. */
  private async validate(trx: Trx, s: AfterConfirmation): Promise<void> {
    const fail = (path: string, code: string, message: string): never => {
      throw new ProblemError(422, "validation_failed", message, [{ path, code, message }]);
    };
    const engineTag = this.config.ENGINE_AUTO_SHIP_TAG?.toLowerCase();
    if (engineTag) {
      for (const [section, tags] of Object.entries({ confirmed: s.confirmed.tags, changed: s.changed.tags, cancelled: s.cancelled.tags, noAnswer: s.noAnswer.tags, optedOut: s.optedOut.tags })) {
        if (tags.includes(engineTag)) fail(`${section}.tags`, "tag_starts_engine_booking", "this tag would book the courier outside Mizan's shipping");
      }
    }
    const overlap = s.confirmed.tags.find((t) => s.cancelled.tags.includes(t));
    if (overlap) fail("cancelled.tags", "tags_overlap", "a tag cannot mean both confirmed and cancelled");
    const courier = s.confirmed.autoBook.enabled ? s.confirmed.autoBook.courierConnectionId : null;
    if (courier && !(await trx.selectFrom("connections").select("id").where("id", "=", courier).where("kind", "=", "courier").where("provider", "=", "bosta").where("status", "!=", "disconnected").executeTakeFirst())) {
      fail("confirmed.autoBook.courierConnectionId", "courier_not_found", "no such courier connection");
    }
    const member = s.changed.assignTo;
    if (member && !(await trx.selectFrom("memberships").select("user_id").where("user_id", "=", member).where("status", "=", "active").executeTakeFirst())) {
      fail("changed.assignTo", "member_not_found", "no active team member with this id");
    }
  }

  // ───────────── the team, on one order ─────────────

  /** Release now: the hold ends and the follow-up runs at once (a booking still checks everything). */
  async release(auth: AuthContext, orderId: string, now = new Date()) {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      // The follow-up before the order: the same lock order as the runner (no deadlock).
      await trx.selectFrom("order_followups").select("id").where("order_id", "=", orderId).where("kind", "=", "release").forUpdate().execute();
      const o = await trx.selectFrom("orders").select(["id", "held_until", "hold_reason"]).where("id", "=", orderId).forUpdate().executeTakeFirst();
      if (!o) throw new ProblemError(404, "order_not_found", "no order with this id");
      await trx.updateTable("orders").set({ held_until: null, hold_reason: null }).where("id", "=", orderId).execute();
      const row = await trx.updateTable("order_followups").set({ status: "pending", run_at: now, result: null, updated_at: now })
        .where("order_id", "=", orderId).where("kind", "=", "release").where("status", "in", ["pending", "blocked"]).returning(["id", "auto_book"]).executeTakeFirst();
      await trx.insertInto("order_events").values({ tenant_id: tenantId, order_id: orderId, type: "after_confirmation_released", actor_type: "user", actor_id: auth.user.id, data: JSON.stringify({ wasHeld: o.hold_reason }) }).execute();
      await this.audit.record(trx, { action: "confirmation.after_released", tenantId, ...auditActor(auth), entity: { type: "order", id: orderId }, before: { holdReason: o.hold_reason }, after: { followup: row?.id ?? null } });
      return { released: true, autoBook: row?.auto_book ?? false };
    });
  }

  /** Book by hand: this order will not book by itself (the hold still ends at its time). */
  async skipAutoBook(auth: AuthContext, orderId: string, now = new Date()) {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const o = await trx.selectFrom("orders").select("id").where("id", "=", orderId).executeTakeFirst();
      if (!o) throw new ProblemError(404, "order_not_found", "no order with this id");
      // Every stage: waiting, refused, or already handed to shipping (the booking checks auto_book before it books).
      const row = await trx.updateTable("order_followups").set({ auto_book: false, result: "by_team", updated_at: now })
        .where("order_id", "=", orderId).where("kind", "=", "release").where("status", "in", ["pending", "blocked", "done"]).returning(["id", "status"]).executeTakeFirst();
      if (row?.status === "blocked") await trx.updateTable("order_followups").set({ status: "done" }).where("id", "=", row.id).execute();
      // The team read what the customer wrote and decided: the order goes back to packing.
      await trx.updateTable("orders").set({ held_until: null, hold_reason: null }).where("id", "=", orderId).where("hold_reason", "=", "customer_message").execute();
      await trx.insertInto("order_events").values({ tenant_id: tenantId, order_id: orderId, type: "auto_book_skipped", actor_type: "user", actor_id: auth.user.id, data: JSON.stringify({}) }).execute();
      await this.audit.record(trx, { action: "confirmation.after_auto_book_skipped", tenantId, ...auditActor(auth), entity: { type: "order", id: orderId }, after: { followup: row?.id ?? null } });
      return { autoBook: false };
    });
  }
}

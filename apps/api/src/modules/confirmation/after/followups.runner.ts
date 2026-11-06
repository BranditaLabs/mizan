import { Inject, Injectable, Logger } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import { asWorker, type DB } from "@mizan/db";
import { Database } from "../../../platform/db/database.js";
import { EventsService } from "../../../platform/events/events.service.js";
import { ConfirmationService } from "../confirmation.service.js";
import { OffersService } from "../offers/offers.service.js";
import { AfterConfirmationService, type Lang } from "./after.service.js";
import { decideNoAnswerCancel, decideRelease, DEFER_MINUTES } from "./decide.js";
import { blockedNotice, notice } from "./notices.js";

type Trx = Transaction<DB>;
type Row = { id: string; order_id: string; run_id: string | null; kind: string; auto_book: boolean; attempts: number; deferrals: number };

/** A follow-up that kept failing stops here and asks for a person. */
const MAX_ATTEMPTS = 6;
const TEAM = ["owner", "admin", "ops_manager"] as const;

/**
 * Fires the follow-ups a confirmation left (E6-23a): release a held order (and hand it to
 * shipping when auto-book is on), or cancel an order nobody answered. They never call a vendor:
 * each one reads, writes rows and emits events in one transaction, so the claim, the effect and
 * "done" commit together (a crash leaves it pending; SKIP LOCKED keeps two workers apart).
 * Called from the confirmation runner's pass.
 */
@Injectable()
export class FollowupsRunner {
  private readonly logger = new Logger("AfterConfirmation");

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(ConfirmationService) private readonly confirmations: ConfirmationService,
    @Inject(OffersService) private readonly offers: OffersService,
    @Inject(AfterConfirmationService) private readonly after: AfterConfirmationService,
  ) {}

  async runOnce(now = new Date()): Promise<number> {
    const due = await asWorker(this.db.kysely, (trx) => trx.selectFrom("order_followups").select("tenant_id").distinct()
      .where("status", "=", "pending").where("run_at", "<=", now).limit(500).execute());
    let n = 0;
    for (const { tenant_id } of due) n += await this.runTenant(tenant_id, now);
    return n;
  }

  private runTenant(tenantId: string, now: Date): Promise<number> {
    return this.db.tenant(tenantId, async (trx) => {
      const rows = await trx.selectFrom("order_followups").select(["id", "order_id", "run_id", "kind", "auto_book", "attempts", "deferrals"])
        .where("status", "=", "pending").where("run_at", "<=", now).orderBy("run_at").limit(50).forUpdate().skipLocked().execute() as Row[];
      if (!rows.length) return 0;
      const { settings, lang } = await this.after.settingsOf(trx, tenantId);
      for (const row of rows) {
        await sql`savepoint followup`.execute(trx);
        try {
          if (row.kind === "release") await this.release(trx, tenantId, row, settings, lang, now);
          else await this.noAnswerCancel(trx, tenantId, row, settings, lang, now);
          await sql`release savepoint followup`.execute(trx);
        } catch (err) {
          await sql`rollback to savepoint followup`.execute(trx);
          const attempts = row.attempts + 1;
          this.logger.error({ err, followup: row.id, attempts }, "follow-up failed");
          if (attempts >= MAX_ATTEMPTS) {
            await trx.updateTable("order_followups").set({ status: "dead", attempts, result: "failed", updated_at: now }).where("id", "=", row.id).execute();
            const o = await trx.selectFrom("orders").select("number").where("id", "=", row.order_id).executeTakeFirst();
            await this.after.notify(trx, tenantId, [...TEAM], notice("followup_dead", o?.number ?? "", lang), row.order_id, `followup.dead:${row.id}`);
          } else {
            await trx.updateTable("order_followups").set({ attempts, run_at: new Date(now.getTime() + Math.min(60, 2 ** attempts) * 60_000), updated_at: now }).where("id", "=", row.id).execute();
          }
        }
      }
      return rows.length;
    });
  }

  private async release(trx: Trx, tenantId: string, row: Row, settings: Awaited<ReturnType<AfterConfirmationService["settingsOf"]>>["settings"], lang: Lang, now: Date): Promise<void> {
    const o = await trx.selectFrom("orders").select(["number", "status", "payment_mode", "stock_status", "duplicate_status", "hold_reason"]).where("id", "=", row.order_id).forUpdate().executeTakeFirstOrThrow();
    const settling = Boolean(await trx.selectFrom("order_offers").select("id").where("order_id", "=", row.order_id).where("status", "in", ["accepted", "applying"]).executeTakeFirst())
      || Boolean(await trx.selectFrom("order_edits").select("id").where("order_id", "=", row.order_id).where("status", "=", "sending").executeTakeFirst());
    const offerProposed = Boolean(await trx.selectFrom("order_offers").select("id").where("order_id", "=", row.order_id).where("status", "=", "proposed").executeTakeFirst());
    const d = decideRelease({
      order: { status: o.status, paymentMode: o.payment_mode, stockStatus: o.stock_status, duplicateStatus: o.duplicate_status, holdReason: o.hold_reason },
      autoBook: row.auto_book, deferrals: row.deferrals, settling, offerProposed, settings,
    });
    const set = (status: string, result: string) => trx.updateTable("order_followups").set({ status, result, updated_at: now }).where("id", "=", row.id).execute();
    const unhold = () => trx.updateTable("orders").set({ held_until: null, hold_reason: null }).where("id", "=", row.order_id).where("hold_reason", "=", "grace").execute();
    switch (d.kind) {
      case "skip":
        if (d.code === "order_moved") await unhold();
        await set("skipped", d.code);
        return;
      case "defer":
        await trx.updateTable("order_followups").set({ run_at: new Date(now.getTime() + DEFER_MINUTES * 60_000), deferrals: row.deferrals + 1, updated_at: now }).where("id", "=", row.id).execute();
        return;
      case "released":
        await unhold();
        await set("done", d.code);
        if (d.code === "offer_settling" && row.auto_book) await this.blocked(trx, tenantId, row, o.number, "offer_settling", lang);
        return;
      case "blocked":
        await unhold();
        await set("blocked", d.code);
        await this.blocked(trx, tenantId, row, o.number, d.code, lang);
        return;
      case "book":
        await unhold();
        if (d.expireOffer) await this.offers.expire(trx, tenantId, row.order_id, now);
        await this.events.emit(trx, {
          type: "order.ready_to_ship", tenantId, entity: { type: "order", id: row.order_id }, actor: { type: "system" },
          data: { number: o.number, followupId: row.id, courierConnectionId: settings.confirmed.autoBook.courierConnectionId, source: "after_confirmation" },
        });
        await set("done", "ready");
        return;
    }
  }

  /** Booking stopped: on the timeline, said to the team (they expected it to book), and an event Automation Studio can react to. */
  private async blocked(trx: Trx, tenantId: string, row: Row, number: string, code: string, lang: Lang): Promise<void> {
    await trx.insertInto("order_events").values({ tenant_id: tenantId, order_id: row.order_id, type: "auto_book_blocked", actor_type: "system", data: JSON.stringify({ code }) }).execute();
    await this.after.notify(trx, tenantId, [...TEAM], blockedNotice(code, number, lang), row.order_id, `after:blocked:${row.id}:${code}`);
    await this.events.emit(trx, { type: "order.auto_ship_blocked", tenantId, entity: { type: "order", id: row.order_id }, actor: { type: "system" }, data: { number, followupId: row.id, code, retry: false } });
  }

  private async noAnswerCancel(trx: Trx, tenantId: string, row: Row, settings: Awaited<ReturnType<AfterConfirmationService["settingsOf"]>>["settings"], lang: Lang, now: Date): Promise<void> {
    const o = await trx.selectFrom("orders").select(["number", "status", "paid_minor", "assigned_to"]).where("id", "=", row.order_id).forUpdate().executeTakeFirstOrThrow();
    const live = await this.confirmations.liveRun(trx, row.order_id);
    const run = live && live.id === row.run_id ? live : null;
    const reason = run ? (await trx.selectFrom("confirmation_runs").select("reason").where("id", "=", run.id).executeTakeFirstOrThrow()).reason : null;
    const d = decideNoAnswerCancel({
      settings, run: run ? { status: run.status, outcome: run.outcome, reason } : null,
      order: { status: o.status, paidMinor: BigInt(o.paid_minor), assignedTo: o.assigned_to },
    });
    if (!d.cancel) {
      await trx.updateTable("order_followups").set({ status: "skipped", result: d.code, updated_at: now }).where("id", "=", row.id).execute();
      return;
    }
    await this.confirmations.applyAnswer(trx, tenantId, row.order_id, run, { answer: "cancel", channel: "auto", actor: { type: "system" }, reason: "no_answer" }, now);
    await trx.updateTable("order_followups").set({ status: "done", result: "cancelled", updated_at: now }).where("id", "=", row.id).execute();
    const n = settings.noAnswer.notify;
    if (n.enabled) await this.after.notify(trx, tenantId, n.roles, notice("auto_cancelled", o.number, lang), row.order_id, `after:auto_cancelled:${row.id}`);
  }
}

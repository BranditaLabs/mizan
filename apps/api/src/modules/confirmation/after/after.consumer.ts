import { Inject, Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";
import type { DB } from "@mizan/db";
import type { DomainEvent } from "@mizan/shared";
import { EventConsumer, type EventHandler } from "../../../platform/events/consumer.js";
import { OrderActions } from "../../orders/order-actions.js";
import { AfterConfirmationService } from "./after.service.js";
import { MAX_DEFERRALS, DEFER_MINUTES } from "./decide.js";
import { blockedNotice, notice } from "./notices.js";

type Trx = Transaction<DB>;
const TEAM = ["owner", "admin", "ops_manager"] as const;

/**
 * What the store chose to happen after each outcome (E6-23a), in the event's transaction: tags
 * (in Mizan and the Shopify order), a notice for the team, assigning a change request, scheduling
 * the cancel of an order nobody answered; and re-arming an automatic booking that waited for a
 * payment or stock. Every action is off unless the store turned it on.
 */
@Injectable()
@EventConsumer({
  name: "confirmation.after",
  events: ["order.confirmed", "order.confirmation_failed", "confirmation.escalated", "confirmation.no_answer", "order.auto_ship_blocked", "order.payment_changed", "stock.reserved"],
})
export class AfterConfirmationConsumer implements EventHandler {
  constructor(
    @Inject(AfterConfirmationService) private readonly after: AfterConfirmationService,
    @Inject(OrderActions) private readonly actions: OrderActions,
  ) {}

  async handle(event: DomainEvent, trx: Trx): Promise<void> {
    const t = event.tenantId;
    const orderId = event.entity.id;
    const d = event.data as Record<string, unknown>;
    const number = String(d.number ?? "");
    const { settings: s, lang } = await this.after.settingsOf(trx, t);
    const ref = { after: event.id };
    const at = new Date(event.occurredAt);
    const act = async (section: { tags: string[]; notify: { enabled: boolean; roles: string[] } }, kind: Parameters<typeof notice>[0]) => {
      if (section.tags.length) await this.actions.tag(trx, t, orderId, section.tags, { type: "system" }, ref);
      if (section.notify.enabled) await this.after.notify(trx, t, section.notify.roles as never, notice(kind, number, lang), orderId, `after:${event.id}`);
    };

    switch (event.type) {
      case "order.confirmed":
        if (d.channel === "exchange") return; // a replacement for an exchange is not a new sale
        await act(s.confirmed, "confirmed");
        return;
      case "order.confirmation_failed":
        if (d.reason === "cancelled") await act(s.cancelled, "cancelled");
        return;
      case "confirmation.escalated":
        if (d.reason === "change_requested") {
          await act(s.changed, "changed");
          if (s.changed.assignTo) await this.actions.assign(trx, t, orderId, s.changed.assignTo, { type: "system" }, ref);
        } else if (d.reason === "opted_out") {
          await act(s.optedOut, "opted_out");
        }
        return;
      case "confirmation.no_answer": {
        await act(s.noAnswer, "no_answer");
        const ac = s.noAnswer.autoCancel;
        if (ac.enabled && d.stage === ac.after && typeof d.runId === "string") {
          const row = await trx.insertInto("order_followups").values({
            tenant_id: t, order_id: orderId, run_id: d.runId, kind: "no_answer_cancel", run_at: new Date(at.getTime() + ac.afterHours * 3_600_000),
            idempotency_key: `no_answer_cancel:${d.runId}`,
          }).onConflict((oc) => oc.columns(["tenant_id", "idempotency_key"]).doNothing()).returning("id").executeTakeFirst();
          if (row) await trx.insertInto("order_events").values({ tenant_id: t, order_id: orderId, type: "auto_cancel_scheduled", actor_type: "system", data: JSON.stringify({ afterHours: ac.afterHours }) }).execute();
        }
        return;
      }
      case "order.auto_ship_blocked": {
        // Shipping's own refusal at booking (the runner's refusals were recorded where they happened).
        if (d.source !== "shipping" || typeof d.followupId !== "string") return;
        const row = await trx.selectFrom("order_followups").select(["id", "deferrals"]).where("id", "=", d.followupId).forUpdate().executeTakeFirst();
        if (!row) return;
        if (d.retry === true && row.deferrals < MAX_DEFERRALS) {
          await trx.updateTable("order_followups").set({ status: "pending", run_at: new Date(at.getTime() + DEFER_MINUTES * 60_000), deferrals: row.deferrals + 1, result: null, updated_at: at })
            .where("id", "=", row.id).execute();
          return;
        }
        const code = String(d.code ?? "failed");
        await trx.updateTable("order_followups").set({ status: "blocked", result: code, updated_at: at }).where("id", "=", row.id).execute();
        await trx.insertInto("order_events").values({ tenant_id: t, order_id: orderId, type: "auto_book_blocked", actor_type: "system", data: JSON.stringify({ code }) }).execute();
        await this.after.notify(trx, t, [...TEAM], blockedNotice(code, number, lang), orderId, `after:${event.id}`);
        return;
      }
      case "order.payment_changed":
        // The payment moved: a booking that waited for it tries again (booking checks the money itself).
        await this.rearm(trx, orderId, "payment_blocks_shipping", at);
        return;
      case "stock.reserved":
        await this.rearm(trx, orderId, "stock_short", at);
        return;
    }
  }

  private async rearm(trx: Trx, orderId: string, code: string, at: Date): Promise<void> {
    await trx.updateTable("order_followups").set({ status: "pending", run_at: at, result: null, updated_at: at })
      .where("order_id", "=", orderId).where("kind", "=", "release").where("status", "=", "blocked").where("result", "=", code).execute();
  }
}

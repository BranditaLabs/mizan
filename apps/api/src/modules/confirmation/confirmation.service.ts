import { Inject, Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import { asWorker, type DB } from "@mizan/db";
import { fromMinor, type Money } from "@mizan/shared";
import { AuditService, auditActor } from "../../platform/audit/audit.service.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { APP_CONFIG, type AppConfig } from "../../platform/config.js";
import { Database } from "../../platform/db/database.js";
import { EventsService } from "../../platform/events/events.service.js";
import { ProblemError } from "../../platform/http/problem.js";
import { PiiCipher } from "../../platform/pii/pii-cipher.js";
import { roleScope } from "../orders/orders.service.js";
import { linkToken, runIdOf } from "./confirmation-link.js";
import { routeFor } from "./routing.js";
import { confirmationSettings, ConfirmationSettingsSchema, nextCallingTime, type AutomatedChannel, type ConfirmationSettings } from "./confirmation.settings.js";
import { callScript, chatContent, linkText, type MessageFacts } from "./messages.js";
import type { Script } from "./script.js";
import type { ScriptPreview } from "./confirmation.dto.js";
import { MessagingRegistry } from "./messaging.registry.js";
import { OffersService } from "./offers/offers.service.js";

export type Answer = "confirm" | "cancel" | "change";
export type AnswerChannel = "link" | "whatsapp" | "voice_ivr" | "voice_ai" | "agent" | "call_team" | "auto";
export interface RunRow {
  id: string; order_id: string; status: string; plan: unknown; step: number; outcome: string | null; link_expires_at: Date; started_at: Date;
  chat_state: string | null; customer_hash: string | null; call_attempts: number; call_after: Date | null;
}

/** Only orders the courier collects cash for are confirmed; prepaid ones get fraud screening (E6-1). */
const CONFIRMS = new Set(["cod", "partial"]);
/** Orders older than this when they reach Mizan (a history import) are never messaged. */
export const FRESH_HOURS = 24;
const LIVE = ["running", "needs_agent"] as const;
const OUTCOME: Record<Answer, "confirmed" | "cancelled" | "changed"> = { confirm: "confirmed", cancel: "cancelled", change: "changed" };
const RUN_COLUMNS = ["id", "order_id", "status", "plan", "step", "outcome", "link_expires_at", "started_at", "chat_state", "customer_hash", "call_attempts", "call_after"] as const;
/**
 * The run's cascade as stored when it started. Positions never change (steps are keyed by them);
 * a pre-E6-10 "voice" step reads as call_auto, and an "sms" step is skipped as unavailable.
 */
export const planOf = (run: Pick<RunRow, "plan">): Array<{ channel: AutomatedChannel | "sms"; waitMinutes: number }> =>
  (Array.isArray(run.plan) ? (run.plan as Array<{ channel: string; waitMinutes: number }>) : [])
    .map((x) => ({ channel: (x.channel === "voice" ? "call_auto" : x.channel) as AutomatedChannel | "sms", waitMinutes: x.waitMinutes }));

/**
 * Automated order confirmation (M2, E6-7, E6-10). A run walks the store's cascade (WhatsApp, an
 * automated call), each step a scheduled row the runner executes; a team-call step, or nothing
 * left, puts the order on the team's "Needs a call" list. Every channel answers through
 * `applyAnswer`, the same way: order status, timeline, attempts log and domain events in one
 * transaction, a second answer refused. WhatsApp answers arrive as button taps (chat.service.ts).
 */
@Injectable()
export class ConfirmationService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(PiiCipher) private readonly cipher: PiiCipher,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(MessagingRegistry) private readonly messaging: MessagingRegistry,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(OffersService) private readonly offers: OffersService,
  ) {}

  /**
   * A new order (consumer of order.created): routed by payment method and risk score (E6-2) when
   * the store turned routing on — confirmed without asking, asked in the chat (the cascade), put
   * on the team's calls, or held for review — else every cash order walks the cascade. Returns
   * the run id, or null when nothing is started.
   */
  async start(trx: Transaction<DB>, tenantId: string, orderId: string, now = new Date()): Promise<string | null> {
    const order = await trx.selectFrom("orders").select(["id", "number", "status", "payment_mode", "payment_status", "paid_minor", "risk_score", "placed_at", "created_at", "duplicate_status"])
      .where("id", "=", orderId).executeTakeFirst();
    if (!order || order.status !== "new") return null;
    if (order.duplicate_status === "suspected") return null; // held until the team keeps or merges it (E5-3)
    if (now.getTime() - order.placed_at.getTime() > FRESH_HOURS * 3_600_000) return null; // imported history: never message old customers
    const { settings } = await this.store(trx, tenantId);
    if (!settings.enabled) return null;
    const route = routeFor({ paymentMode: order.payment_mode, paid: BigInt(order.paid_minor) > 0n || order.payment_status === "paid", score: order.risk_score }, settings.routing);
    if (!route) return null;
    if (await this.liveRun(trx, orderId)) return null;
    if (settings.routing.enabled) {
      await trx.updateTable("orders").set({ confirm_route: route }).where("id", "=", orderId).execute();
      await this.events.emit(trx, { type: "confirmation.routed", tenantId, entity: { type: "order", id: orderId }, actor: { type: "system" }, data: { number: order.number, route, score: order.risk_score } });
    }
    if (route === "auto") {
      // Trusted enough (or paid): confirmed without asking the customer.
      await this.applyAnswer(trx, tenantId, orderId, null, { answer: "confirm", channel: "auto", actor: { type: "system" } }, now);
      return null;
    }
    if (!CONFIRMS.has(order.payment_mode) && route !== "hold") return null;
    const run = await trx.insertInto("confirmation_runs").values({
      tenant_id: tenantId, order_id: orderId, plan: JSON.stringify(settings.steps), link_expires_at: new Date(now.getTime() + settings.linkHours * 3_600_000),
    }).returning(RUN_COLUMNS).executeTakeFirstOrThrow() as RunRow;
    await this.setOrderStatus(trx, tenantId, orderId, "new", "pending_confirmation", "confirmation_started", { type: "system" }, { steps: String(settings.steps.length) });
    await this.events.emit(trx, { type: "confirmation.started", tenantId, entity: { type: "order", id: orderId }, actor: { type: "system" }, data: { number: order.number, runId: run.id, steps: settings.steps.map((s) => s.channel) } });
    // The offer is chosen now (E6-11): ready the moment the customer confirms, and in the team's script.
    await this.offers.propose(trx, tenantId, run, now);
    if (route === "agent" || route === "hold") {
      // Too risky to message automatically: the team calls (agent) or reviews it first (hold).
      await this.escalate(trx, tenantId, run, route === "agent" ? "high_risk" : "hold", now);
      return run.id;
    }
    await this.advance(trx, tenantId, run, 0, now);
    return run.id;
  }

  /**
   * Schedules the first step at or after `from` whose channel the store can use (calls inside
   * calling hours); none left → the order goes to an agent.
   */
  async advance(trx: Transaction<DB>, tenantId: string, run: RunRow, from: number, now: Date): Promise<void> {
    const plan = planOf(run);
    const channels = await this.messaging.channels(tenantId, trx);
    let optedOut = false;
    for (let idx = from; idx < plan.length; idx++) {
      const step = plan[idx]!;
      if (step.channel === "call_team") {
        // The automatic part ends here: the order goes on the team's call list.
        await trx.updateTable("confirmation_runs").set({ step: idx }).where("id", "=", run.id).execute();
        await this.insertStep(trx, tenantId, run.id, idx, step.channel, "send", now, "done");
        await this.escalate(trx, tenantId, run, optedOut ? "opted_out" : "team_call", now);
        return;
      }
      if (step.channel === "sms" || !channels[step.channel]) {
        await this.insertStep(trx, tenantId, run.id, idx, step.channel, "send", now, "skipped", "channel not connected");
        continue;
      }
      if (step.channel === "whatsapp" && (await this.optedOut(trx, run.order_id))) {
        // The customer wrote STOP (E6-4b): no message, the next channel (usually the team's call).
        await this.insertStep(trx, tenantId, run.id, idx, step.channel, "send", now, "skipped", "customer opted out");
        optedOut = true;
        continue;
      }
      let at = now;
      if (step.channel === "call_auto") {
        const { settings, timezone } = await this.store(trx, tenantId);
        at = nextCallingTime(now, settings.callingHours, timezone);
      }
      await trx.updateTable("confirmation_runs").set({ step: idx }).where("id", "=", run.id).execute();
      await this.insertStep(trx, tenantId, run.id, idx, step.channel, "send", at);
      return;
    }
    // Nothing could be tried at all → no channel; something was tried and nobody answered → no reply.
    await this.escalate(trx, tenantId, run, optedOut ? "opted_out" : from === 0 ? "no_channel" : "no_reply", now);
  }

  async escalate(trx: Transaction<DB>, tenantId: string, run: RunRow, reason: string, now: Date): Promise<void> {
    if (run.status !== "running") return;
    // On the team's list from the next calling hour.
    const { settings, timezone } = await this.store(trx, tenantId);
    const callAfter = nextCallingTime(now, settings.callingHours, timezone);
    await trx.updateTable("confirmation_runs").set({ status: "needs_agent", reason, call_after: callAfter > now ? callAfter : null, ...(reason === "no_reply" ? { outcome: "no_reply" } : {}) }).where("id", "=", run.id).execute();
    await this.cancelSteps(trx, run.id, now);
    const order = await trx.selectFrom("orders").select("number").where("id", "=", run.order_id).executeTakeFirstOrThrow();
    await trx.insertInto("order_events").values({ tenant_id: tenantId, order_id: run.order_id, type: "confirmation_escalated", actor_type: "system", data: JSON.stringify({ reason }) }).execute();
    await this.events.emit(trx, { type: "confirmation.escalated", tenantId, entity: { type: "order", id: run.order_id }, actor: { type: "system" }, data: { number: order.number, runId: run.id, reason } });
  }

  /** The order changed elsewhere (cancelled or paid in the store): stop asking the customer. */
  async stop(trx: Transaction<DB>, orderId: string, reason: string, now = new Date()): Promise<void> {
    const run = await this.liveRun(trx, orderId);
    if (!run) return;
    await trx.updateTable("confirmation_runs").set({ status: "stopped", reason, finished_at: now }).where("id", "=", run.id).execute();
    await this.cancelSteps(trx, run.id, now);
  }

  /**
   * One answer, from any channel: confirm → Confirmed, cancel → Cancelled, change → an agent
   * calls back. Refused (409) once the order is past confirmation or the run already answered.
   */
  async applyAnswer(trx: Transaction<DB>, tenantId: string, orderId: string, run: RunRow | null, a: {
    answer: Answer; channel: AnswerChannel; actor: { type: "customer" } | { type: "system" } | { type: "user"; id: string }; reason?: string; note?: string; location?: { lat: number; lng: number };
  }, now = new Date()): Promise<{ outcome: string }> {
    if (run && run.outcome && run.status !== "needs_agent") throw new ProblemError(409, "already_answered", `this order was already ${run.outcome}`);
    const order = await trx.selectFrom("orders").select(["status", "number"]).where("id", "=", orderId).executeTakeFirstOrThrow();
    if (!["new", "pending_confirmation"].includes(order.status)) throw new ProblemError(409, "already_answered", `this order is already ${order.status}`);
    const outcome = OUTCOME[a.answer];
    const pii = a.note ? await this.cipher.forTenant(trx, tenantId) : null;
    await trx.insertInto("confirmations").values({
      tenant_id: tenantId, order_id: orderId, run_id: run?.id ?? null, channel: a.channel, outcome, started_at: now, finished_at: now,
      agent_id: a.actor.type === "user" ? a.actor.id : null, notes: pii?.encrypt(a.note, "confirmations.notes") ?? null,
    }).execute();
    if (a.location) await trx.updateTable("orders").set({ ship_lat: a.location.lat, ship_lng: a.location.lng }).where("id", "=", orderId).execute();
    const actor = a.actor.type === "user" ? { type: "user" as const, id: a.actor.id } : { type: "customer" as const };
    const data = { channel: a.channel, ...(a.reason ? { reason: a.reason } : {}) };
    if (run) {
      await this.cancelSteps(trx, run.id, now);
      await trx.updateTable("confirmation_runs").set(a.answer === "change"
        ? { status: "needs_agent", outcome, answered_channel: a.channel, reason: "change_requested", chat_state: null, call_after: null }
        : { status: outcome, outcome, answered_channel: a.channel, finished_at: now, chat_state: null, ...(a.reason ? { reason: a.reason } : {}) }).where("id", "=", run.id).execute();
    }
    const evActor = actor.type === "user" ? { type: "user" as const, id: actor.id } : { type: "system" as const };
    if (a.answer === "confirm") {
      await this.setOrderStatus(trx, tenantId, orderId, order.status, "confirmed", "confirmed", actor, data, { confirmed_at: now });
      await this.events.emit(trx, { type: "order.confirmed", tenantId, entity: { type: "order", id: orderId }, actor: evActor, data: { number: order.number, channel: a.channel, ...(run ? { runId: run.id } : {}) } });
    } else if (a.answer === "cancel") {
      await this.setOrderStatus(trx, tenantId, orderId, order.status, "cancelled", "cancelled", actor, { ...data, reason: a.reason ?? "customer_cancelled" }, { cancelled_at: now });
      await this.events.emit(trx, { type: "order.cancelled", tenantId, entity: { type: "order", id: orderId }, actor: evActor, data: { number: order.number, reason: a.reason ?? "customer_cancelled", channel: a.channel } });
      await this.events.emit(trx, { type: "order.confirmation_failed", tenantId, entity: { type: "order", id: orderId }, actor: evActor, data: { number: order.number, reason: "cancelled", channel: a.channel } });
    } else {
      await trx.insertInto("order_events").values({ tenant_id: tenantId, order_id: orderId, type: "change_requested", actor_type: actor.type, actor_id: actor.type === "user" ? actor.id : null, data: JSON.stringify(data) }).execute();
      await this.events.emit(trx, { type: "confirmation.escalated", tenantId, entity: { type: "order", id: orderId }, actor: evActor, data: { number: order.number, reason: "change_requested", channel: a.channel } });
    }
    return { outcome };
  }

  /** The customer's link: `{WEB_URL}/{lang}/c/{token}`. */
  linkFor(runId: string, lang: "ar" | "en"): string {
    return `${this.config.WEB_URL.replace(/\/$/, "")}/${lang}/c/${linkToken(this.config.LINK_SIGNING_KEY, runId)}`;
  }

  /** Everything a message needs, read inside the store's transaction. Null when the order has no phone. */
  async facts(trx: Transaction<DB>, tenantId: string, run: Pick<RunRow, "id" | "order_id" | "customer_hash">): Promise<{ to: string; facts: MessageFacts } | null> {
    const o = await trx.selectFrom("orders").select(["number", "ship_phone", "customer_label", "currency", "total_minor", "cod_minor", "ship_city"]).where("id", "=", run.order_id).executeTakeFirstOrThrow();
    const pii = await this.cipher.forTenant(trx, tenantId);
    const to = pii.decrypt(o.ship_phone, "orders.ship_phone");
    if (!to) return null;
    // The number's hash finds this run when the customer types instead of tapping (E6-10).
    if (!run.customer_hash) await trx.updateTable("confirmation_runs").set({ customer_hash: pii.phoneHash(to) }).where("id", "=", run.id).execute();
    const { name, lang, settings } = await this.store(trx, tenantId);
    const label = pii.decrypt(o.customer_label, "orders.customer_label");
    const items = await trx.selectFrom("order_lines").select(["title", "quantity"]).where("order_id", "=", run.order_id).orderBy("id").limit(10).execute();
    const due = BigInt(o.cod_minor) > 0n ? BigInt(o.cod_minor) : BigInt(o.total_minor);
    const f = await this.offers.forRun(trx, run.id);
    const offer = f && !["declined", "expired"].includes(f.status) ? (() => {
      const v = this.offers.view(f);
      return {
        id: f.id, title: v.title, qty: v.qty, price: v.offerPrice, was: Number(v.discountPct) > 0 ? v.unitPrice : null,
        message: lang === "ar" ? f.message_ar : f.message_en, newTotal: fromMinor(due + BigInt(f.offer_price_minor) * BigInt(f.qty), o.currency),
      };
    })() : null;
    return {
      to,
      facts: {
        lang, store: name, firstName: label?.split(" ")[0] ?? null, number: o.number,
        total: fromMinor(BigInt(o.total_minor), o.currency), cod: fromMinor(BigInt(o.cod_minor), o.currency), link: this.linkFor(run.id, lang),
        items: items.map((i) => ({ title: i.title, quantity: i.quantity })), city: o.ship_city, offer, ...(settings.script ? { script: settings.script } : {}),
      },
    };
  }

  /**
   * E6-5: what a script says, filled from one of the store's orders (or a sample one): each chat
   * reply by the button it answers, and the team's call script. Only the first name, number, items,
   * amounts and city — what the messages show anyway.
   */
  async previewScript(tenantId: string, script: Script, orderId?: string): Promise<ScriptPreview> {
    return this.db.tenant(tenantId, async (trx) => {
      const { name, lang } = await this.store(trx, tenantId);
      let f: MessageFacts;
      if (orderId) {
        const o = await trx.selectFrom("orders").select(["number", "customer_label", "currency", "total_minor", "cod_minor", "ship_city"]).where("id", "=", orderId).executeTakeFirst();
        if (!o) throw new ProblemError(404, "not_found", "order not found");
        const label = (await this.cipher.forTenant(trx, tenantId)).decrypt(o.customer_label, "orders.customer_label");
        const items = await trx.selectFrom("order_lines").select(["title", "quantity"]).where("order_id", "=", orderId).orderBy("id").limit(10).execute();
        f = { lang, store: name, firstName: label?.split(" ")[0] ?? null, number: o.number, total: fromMinor(BigInt(o.total_minor), o.currency), cod: fromMinor(BigInt(o.cod_minor), o.currency), link: "", items, city: o.ship_city };
      } else {
        const t = await trx.selectFrom("tenants").select("base_currency").where("id", "=", tenantId).executeTakeFirstOrThrow();
        const cur = t.base_currency.trim();
        f = lang === "ar"
          ? { lang, store: name, firstName: "منى", number: "#1001", total: fromMinor(125000n, cur), cod: fromMinor(125000n, cur), link: "", items: [{ title: "عباية سادة", quantity: 1 }], city: "مدينة نصر" }
          : { lang, store: name, firstName: "Mona", number: "#1001", total: fromMinor(125000n, cur), cod: fromMinor(125000n, cur), link: "", items: [{ title: "Plain abaya", quantity: 1 }], city: "Nasr City" };
      }
      f.script = script;
      const text = (c: ReturnType<typeof chatContent>) => (c.type === "text" ? c.text : c.body);
      return {
        lang, sample: !orderId,
        replies: [
          { branch: "confirm", key: "confirmed", text: text(chatContent("confirmed", f)) },
          { branch: "change", key: "change_prompt", text: text(chatContent("change_prompt", f)) },
          { branch: "change", key: "change_received", text: text(chatContent("change_received", f)) },
          { branch: "cancel", key: "cancel_prompt", text: text(chatContent("cancel_reasons", f)) },
          { branch: "cancel", key: "cancelled", text: text(chatContent("cancelled", f)) },
        ],
        call: callScript(f),
      };
    });
  }

  // ───────────── public link page ─────────────

  /** What the customer sees on the link page: their order, nothing that identifies them beyond a first name. */
  async view(token: string, now = new Date()) {
    const { tenantId, runId } = await this.locate(token);
    return this.db.tenant(tenantId, async (trx) => this.publicView(trx, tenantId, await this.runById(trx, runId), now));
  }

  async answerByLink(token: string, body: { answer: Answer; reason?: string; note?: string; location?: { lat: number; lng: number } }, now = new Date()) {
    const { tenantId, runId } = await this.locate(token);
    return this.db.tenant(tenantId, async (trx) => {
      const run = await this.runById(trx, runId, true);
      if (run.link_expires_at < now) throw new ProblemError(410, "link_expired", "this link has expired; the store will contact you");
      if (run.status === "stopped" || (run.outcome && run.status !== "needs_agent") || (run.status === "needs_agent" && run.outcome === "changed")) {
        throw new ProblemError(409, "already_answered", "this order was already answered");
      }
      await this.applyAnswer(trx, tenantId, run.order_id, run, { ...body, channel: "link", actor: { type: "customer" } }, now);
      return this.publicView(trx, tenantId, await this.runById(trx, runId), now);
    });
  }

  private async locate(token: string): Promise<{ tenantId: string; runId: string }> {
    const runId = runIdOf(this.config.LINK_SIGNING_KEY, token);
    const found = runId ? await asWorker(this.db.kysely, (trx) => trx.selectFrom("confirmation_runs").select("tenant_id").where("id", "=", runId).executeTakeFirst()) : undefined;
    if (!runId || !found) throw new ProblemError(404, "not_found", "this link is not valid");
    return { tenantId: found.tenant_id, runId };
  }

  private async publicView(trx: Transaction<DB>, tenantId: string, run: RunRow, now: Date) {
    const o = await trx.selectFrom("orders").select(["number", "status", "customer_label", "currency", "total_minor", "cod_minor", "ship_city", "ship_lat"]).where("id", "=", run.order_id).executeTakeFirstOrThrow();
    const lines = await trx.selectFrom("order_lines").select(["title", "quantity"]).where("order_id", "=", run.order_id).orderBy("id").execute();
    const { name } = await this.store(trx, tenantId);
    const label = (await this.cipher.forTenant(trx, tenantId)).decrypt(o.customer_label, "orders.customer_label");
    const money = (minor: string | number | bigint): Money => fromMinor(BigInt(minor), o.currency);
    const state = run.status === "stopped" ? "closed"
      : run.outcome === "confirmed" ? "confirmed" : run.outcome === "cancelled" ? "cancelled" : run.outcome === "changed" ? "changed"
      : run.link_expires_at < now ? "expired" : o.status === "pending_confirmation" || o.status === "new" ? "open" : "closed";
    return {
      store: name, state, firstName: label?.split(" ")[0] ?? null,
      order: { number: o.number, items: lines.map((l) => ({ title: l.title, quantity: l.quantity })), total: money(o.total_minor), cod: money(o.cod_minor), city: o.ship_city },
      hasLocation: o.ship_lat !== null, expiresAt: run.link_expires_at.toISOString(),
    };
  }

  // ───────────── staff ─────────────

  /** The order's confirmation for the order screen: the run, its steps and the answers so far. */
  async summary(auth: AuthContext, orderId: string) {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      await this.scopedOrder(trx, auth, orderId);
      const run = await trx.selectFrom("confirmation_runs").select(RUN_COLUMNS).select(["answered_channel", "reason", "finished_at"]).where("order_id", "=", orderId).orderBy("started_at", "desc").executeTakeFirst();
      const steps = run ? await trx.selectFrom("confirmation_steps").select(["idx", "channel", "kind", "status", "run_at", "updated_at"]).where("run_id", "=", run.id).orderBy("run_at").orderBy("idx").execute() : [];
      const attempts = await trx.selectFrom("confirmations").select(["channel", "outcome", "started_at"]).where("order_id", "=", orderId).orderBy("started_at", "desc").limit(50).execute();
      const chat = await trx.selectFrom("whatsapp_messages").select(["direction", "kind", "action", "status", "error_code", "created_at"])
        .where("order_id", "=", orderId).orderBy("created_at").orderBy("id").limit(50).execute();
      const next = steps.find((s) => (s.status === "pending" || s.status === "running") && s.kind !== "reply");
      const { settings } = await this.store(trx, tenantId);
      const order = await trx.selectFrom("orders").select("status").where("id", "=", orderId).executeTakeFirstOrThrow();
      const open = Boolean(run) && ["new", "pending_confirmation"].includes(order.status);
      const f = open && run ? await this.facts(trx, tenantId, run as RunRow) : null;
      const offerRow = run ? await this.offers.forRun(trx, run.id) : null;
      const offerSettings = await this.offers.settings(trx, tenantId);
      if (f && !offerSettings.inCalls) f.facts.offer = null;
      return {
        run: run ? {
          id: run.id, status: run.status as "running", outcome: run.outcome, reason: run.reason, answeredChannel: run.answered_channel,
          plan: planOf(run as RunRow).filter((x): x is { channel: AutomatedChannel; waitMinutes: number } => x.channel !== "sms"), step: run.step, startedAt: run.started_at.toISOString(), finishedAt: run.finished_at?.toISOString() ?? null,
          linkExpiresAt: run.link_expires_at.toISOString(), next: next ? { channel: next.channel, kind: next.kind as "send", at: next.run_at.toISOString() } : null,
          calls: { attempts: run.call_attempts, max: settings.teamCalls.attempts, after: run.call_after?.toISOString() ?? null },
        } : null,
        steps: steps.filter((s) => s.kind === "send").map((s) => ({ idx: s.idx, channel: s.channel, status: s.status, at: s.run_at.toISOString() })),
        attempts: attempts.map((x) => ({ channel: x.channel, outcome: x.outcome, at: x.started_at.toISOString() })),
        whatsapp: chat.map((m) => ({ direction: m.direction as "in", kind: m.kind, action: m.action, status: m.status, errorCode: m.error_code, at: m.created_at.toISOString() })),
        optedOut: await this.optedOut(trx, orderId),
        script: f ? callScript(f.facts) : [],
        offer: offerRow ? this.offers.view(offerRow) : null,
        channels: await this.messaging.channels(tenantId, trx),
      };
    });
  }

  /**
   * A link for the agent to send by hand (no vendor connected, or the customer asks again):
   * the live run's link, or a new manual run. Includes a WhatsApp (wa.me) link with the message.
   */
  async manualLink(auth: AuthContext, orderId: string, now = new Date()) {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const order = await this.scopedOrder(trx, auth, orderId);
      if (!["new", "pending_confirmation"].includes(order.status)) throw new ProblemError(409, "already_answered", `this order is already ${order.status}`);
      const { settings } = await this.store(trx, tenantId);
      const expires = new Date(now.getTime() + settings.linkHours * 3_600_000);
      let run = await this.liveRun(trx, orderId);
      if (run) {
        if (run.link_expires_at < expires) await trx.updateTable("confirmation_runs").set({ link_expires_at: expires }).where("id", "=", run.id).execute();
      } else {
        run = await trx.insertInto("confirmation_runs").values({ tenant_id: tenantId, order_id: orderId, status: "needs_agent", reason: "manual", link_expires_at: expires })
          .returning(RUN_COLUMNS).executeTakeFirstOrThrow() as RunRow;
        if (order.status === "new") await this.setOrderStatus(trx, tenantId, orderId, "new", "pending_confirmation", "confirmation_started", { type: "user", id: auth.user.id }, { manual: "true" });
      }
      const f = await this.facts(trx, tenantId, run);
      await this.audit.record(trx, { action: "confirmation.link_created", tenantId, ...auditActor(auth), entity: { type: "order", id: orderId }, after: { runId: run.id, whatsapp: Boolean(f) } });
      const url = this.linkFor(run.id, f?.facts.lang ?? "ar");
      return {
        url, expiresAt: expires.toISOString(),
        whatsappUrl: f ? `https://wa.me/${f.to.replace(/^\+/, "")}?text=${encodeURIComponent(linkText(f.facts))}` : null,
      };
    });
  }

  async agentAnswer(auth: AuthContext, orderId: string, body: { answer: "confirm" | "cancel"; reason?: string; note?: string; byCall?: boolean }, now = new Date()) {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      await this.scopedOrder(trx, auth, orderId);
      const run = await this.liveRun(trx, orderId);
      const { byCall, ...answer } = body;
      const r = await this.applyAnswer(trx, tenantId, orderId, run, { ...answer, channel: byCall ? "call_team" : "agent", actor: { type: "user", id: auth.user.id } }, now);
      await this.audit.record(trx, { action: "confirmation.answered_by_agent", tenantId, ...auditActor(auth), entity: { type: "order", id: orderId }, after: { answer: body.answer, ...(body.reason ? { reason: body.reason } : {}) } });
      return r;
    });
  }

  /**
   * The team called and nobody answered (E6-10): the order leaves the list and comes back after
   * the store's retry time; after the last try it stays on the list, marked unreachable.
   */
  async noAnswer(auth: AuthContext, orderId: string, now = new Date()) {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      await this.scopedOrder(trx, auth, orderId);
      const run = await this.liveRun(trx, orderId);
      if (!run || run.status !== "needs_agent") throw new ProblemError(409, "not_waiting_for_call", "this order is not waiting for a call");
      const { settings, timezone } = await this.store(trx, tenantId);
      const attempts = run.call_attempts + 1;
      const last = attempts >= settings.teamCalls.attempts;
      const after = last ? null : nextCallingTime(new Date(now.getTime() + settings.teamCalls.retryMinutes * 60_000), settings.callingHours, timezone);
      await trx.updateTable("confirmation_runs").set({ call_attempts: attempts, call_after: after, ...(last ? { reason: "unreachable", outcome: "no_reply" } : {}) }).where("id", "=", run.id).execute();
      await trx.insertInto("confirmations").values({ tenant_id: tenantId, order_id: orderId, run_id: run.id, channel: "call_team", attempt: attempts, outcome: "no_answer", agent_id: auth.user.id, started_at: now, finished_at: now }).execute();
      await trx.insertInto("order_events").values({ tenant_id: tenantId, order_id: orderId, type: "call_no_answer", actor_type: "user", actor_id: auth.user.id, data: JSON.stringify({ channel: "call_team", attempt: String(attempts) }) }).execute();
      await this.audit.record(trx, { action: "confirmation.call_no_answer", tenantId, ...auditActor(auth), entity: { type: "order", id: orderId }, after: { attempts, callAfter: after?.toISOString() ?? null } });
      return { attempts, max: settings.teamCalls.attempts, after: after?.toISOString() ?? null, unreachable: last };
    });
  }

  // ───────────── settings ─────────────

  async getSettings(tenantId: string) {
    return this.db.tenant(tenantId, async (trx) => ({ settings: (await this.store(trx, tenantId)).settings, channels: await this.messaging.channels(tenantId, trx) }));
  }

  async putSettings(auth: AuthContext, body: ConfirmationSettings) {
    const tenantId = auth.tenant!.id;
    const next = ConfirmationSettingsSchema.parse(body);
    return this.db.tenant(tenantId, async (trx) => {
      const t = await trx.selectFrom("tenants").select("settings").where("id", "=", tenantId).forUpdate().executeTakeFirstOrThrow();
      const before = confirmationSettings(t.settings);
      await trx.updateTable("tenants").set({ settings: JSON.stringify({ ...(t.settings as object), confirmation: next }) }).where("id", "=", tenantId).execute();
      await this.audit.record(trx, { action: "confirmation.settings_updated", tenantId, ...auditActor(auth), entity: { type: "tenant", id: tenantId }, before, after: next });
      return { settings: next, channels: await this.messaging.channels(tenantId, trx) };
    });
  }

  // ───────────── helpers ─────────────

  async liveRun(trx: Transaction<DB>, orderId: string): Promise<RunRow | null> {
    return (await trx.selectFrom("confirmation_runs").select(RUN_COLUMNS).where("order_id", "=", orderId).where("status", "in", [...LIVE]).executeTakeFirst() as RunRow | undefined) ?? null;
  }

  async runById(trx: Transaction<DB>, runId: string, lock = false): Promise<RunRow> {
    let q = trx.selectFrom("confirmation_runs").select(RUN_COLUMNS).where("id", "=", runId);
    if (lock) q = q.forUpdate();
    const run = await q.executeTakeFirst();
    if (!run) throw new ProblemError(404, "not_found", "this link is not valid");
    return run as RunRow;
  }

  async insertStep(trx: Transaction<DB>, tenantId: string, runId: string, idx: number, channel: string, kind: "send" | "timeout", at: Date, status: "pending" | "skipped" | "done" = "pending", note?: string): Promise<void> {
    await trx.insertInto("confirmation_steps").values({
      tenant_id: tenantId, run_id: runId, idx, channel, kind, run_at: at, status, idempotency_key: `${runId}:${idx}:${kind}`, last_error: note ?? null,
    }).onConflict((oc) => oc.columns(["tenant_id", "idempotency_key"]).doNothing()).execute();
  }

  /**
   * A follow-up message in the chat (E6-10), queued like any send. Keyed by what it answers (the
   * customer's message id), so a redelivered tap never sends it twice.
   */
  async queueReply(trx: Transaction<DB>, tenantId: string, run: Pick<RunRow, "id" | "step">, message: string, inReplyTo: string, now: Date): Promise<void> {
    await trx.insertInto("confirmation_steps").values({
      tenant_id: tenantId, run_id: run.id, idx: run.step, channel: "whatsapp", kind: "reply", run_at: now, payload: JSON.stringify({ message }), idempotency_key: `${run.id}:reply:${inReplyTo}`,
    }).onConflict((oc) => oc.columns(["tenant_id", "idempotency_key"]).doNothing()).execute();
  }

  /** The order's customer wrote STOP in the chat (E6-4b). */
  async optedOut(trx: Transaction<DB>, orderId: string): Promise<boolean> {
    const c = await trx.selectFrom("orders as o").innerJoin("customers as c", "c.id", "o.customer_id").select("c.whatsapp_opt_out_at").where("o.id", "=", orderId).executeTakeFirst();
    return Boolean(c?.whatsapp_opt_out_at);
  }

  /** Cancels the run's waiting sends and waits; replies already queued in the chat still go out. */
  async cancelSteps(trx: Transaction<DB>, runId: string, now: Date): Promise<void> {
    await trx.updateTable("confirmation_steps").set({ status: "cancelled", updated_at: now }).where("run_id", "=", runId).where("kind", "!=", "reply").where("status", "in", ["pending", "running"]).execute();
  }

  private async scopedOrder(trx: Transaction<DB>, auth: AuthContext, orderId: string) {
    const o = await trx.selectFrom("orders as o").select(["o.id", "o.status"]).where("o.id", "=", orderId).where((eb) => roleScope(eb, auth)).executeTakeFirst();
    if (!o) throw new ProblemError(404, "not_found", "no such order in this store");
    return o;
  }

  private async setOrderStatus(trx: Transaction<DB>, tenantId: string, orderId: string, from: string, to: string, type: string,
    actor: { type: "system" | "customer" } | { type: "user"; id: string }, data: Record<string, string>, extra: { confirmed_at?: Date; cancelled_at?: Date } = {}): Promise<void> {
    await trx.updateTable("orders").set({ status: to, updated_at: sql`now()`, ...extra }).where("id", "=", orderId).execute();
    await trx.insertInto("order_events").values({
      tenant_id: tenantId, order_id: orderId, type, from_status: from, to_status: to, actor_type: actor.type, actor_id: actor.type === "user" ? actor.id : null, data: JSON.stringify(data),
    }).execute();
  }

  async store(trx: Transaction<DB>, tenantId: string): Promise<{ settings: ConfirmationSettings; timezone: string; name: string; lang: "ar" | "en" }> {
    const t = await trx.selectFrom("tenants").select(["settings", "timezone", "name", "locale"]).where("id", "=", tenantId).executeTakeFirstOrThrow();
    return { settings: confirmationSettings(t.settings), timezone: t.timezone, name: t.name, lang: t.locale?.startsWith("en") ? "en" : "ar" };
  }
}

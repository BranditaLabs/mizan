import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { sql } from "kysely";
import { asWorker } from "@mizan/db";
import { afterUnknownSend, isIntegrationError, type MessagingProvider, type WhatsAppChat } from "@mizan/engine";
import { APP_CONFIG, runsWorkerInProcess, type AppConfig } from "../../platform/config.js";
import { Database } from "../../platform/db/database.js";
import { EventsService } from "../../platform/events/events.service.js";
import { MetricsService } from "../../platform/metrics/metrics.service.js";
import { actionId } from "./confirmation-link.js";
import { ConfirmationService, type RunRow } from "./confirmation.service.js";
import { CALL_DIGITS, callPrompts, chatContent, CHAT_MESSAGES, TEMPLATE_ACTIONS, templateName, whatsappParams, type ChatMessage, type MessageFacts } from "./messages.js";
import { canChat, MessagingRegistry } from "./messaging.registry.js";
import { WhatsAppConnections } from "./whatsapp-connections.service.js";

interface StepRow { id: string; run_id: string; idx: number; channel: string; kind: string; attempts: number; idempotency_key: string; payload: unknown; last_error: string | null; updated_at: Date }

const LEASE_MS = 2 * 60_000;
const MAX_ATTEMPTS = 5;
/** Retry delays for a vendor that failed for now (1, 2, 4, 8 minutes). */
const backoff = (attempt: number) => Math.min(8, 2 ** (attempt - 1)) * 60_000;
/** A WhatsApp send whose response was lost is checked again after this long (its status webhook decides). */
const VERIFY_MS = 10 * 60_000;
const UNKNOWN = "unknown_outcome";

type Sent = { ref: string };

/**
 * Runs due confirmation steps (E6-7, E6-10). For each store with due steps: claim them in a short
 * transaction, call the vendor outside any transaction, then record the result in a second one.
 * A send schedules its wait; a wait that ends unanswered moves to the next step; a reply is a
 * follow-up message in the WhatsApp chat. Retryable vendor errors back off; a refused number or
 * exhausted retries move on to the next channel. A WhatsApp send whose response was lost is
 * never re-sent blindly: Meta's status webhook for its key proves it went out (rule 5).
 */
@Injectable()
export class ConfirmationRunner implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger("Confirmation");
  private timer?: NodeJS.Timeout;
  private running?: Promise<unknown>;

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(ConfirmationService) private readonly confirmations: ConfirmationService,
    @Inject(MessagingRegistry) private readonly messaging: MessagingRegistry,
    @Inject(WhatsAppConnections) private readonly whatsappConnections: WhatsAppConnections,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(MetricsService) private readonly metrics: MetricsService,
  ) {}

  onApplicationBootstrap(): void {
    if (runsWorkerInProcess(this.config)) this.start();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.stop();
  }

  start(intervalMs = 15_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => { this.running ??= this.runOnce().catch((err) => this.logger.error({ err }, "confirmation run failed")).finally(() => { this.running = undefined; }); }, intervalMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
  }

  /** One pass: WhatsApp numbers waiting for their check, then every store with due steps. Returns how many steps ran. */
  async runOnce(now = new Date()): Promise<number> {
    await this.whatsappConnections.checkWaiting(now).catch((err) => this.logger.error({ err }, "whatsapp connection check failed"));
    const due = await asWorker(this.db.kysely, (trx) => trx.selectFrom("confirmation_steps").select("tenant_id").distinct()
      .where((eb) => eb.or([
        eb.and([eb("status", "=", "pending"), eb("run_at", "<=", now)]),
        eb.and([eb("status", "=", "running"), eb("locked_until", "<", now)]),
      ])).limit(500).execute());
    let n = 0;
    for (const { tenant_id } of due) {
      // A step that schedules the next one for "now" (a skipped channel, a wait that ended) runs in the same pass.
      for (let pass = 0; pass < 10; pass++) {
        const ran = await this.runTenant(tenant_id, now);
        n += ran;
        if (!ran) break;
      }
    }
    return n;
  }

  private async runTenant(tenantId: string, now: Date): Promise<number> {
    const claimed = await this.db.tenant(tenantId, async (trx) => {
      const rows = await trx.selectFrom("confirmation_steps").select(["id", "run_id", "idx", "channel", "kind", "attempts", "idempotency_key", "payload", "last_error", "updated_at"])
        .where((eb) => eb.or([
          eb.and([eb("status", "=", "pending"), eb("run_at", "<=", now)]),
          eb.and([eb("status", "=", "running"), eb("locked_until", "<", now)]),
        ])).orderBy("run_at").limit(50).forUpdate().skipLocked().execute();
      if (rows.length) {
        await trx.updateTable("confirmation_steps").set({ status: "running", attempts: sql`attempts + 1`, locked_until: new Date(now.getTime() + LEASE_MS), updated_at: now })
          .where("id", "in", rows.map((r) => r.id)).execute();
      }
      return rows.map((r) => ({ ...r, attempts: r.attempts + 1 })) as StepRow[];
    });
    for (const step of claimed) {
      try {
        await (step.kind === "timeout" ? this.timeout(tenantId, step, now) : this.send(tenantId, step, now));
      } catch (err) {
        this.logger.error({ err, step: step.id }, "confirmation step failed");
      }
    }
    return claimed.length;
  }

  /** The wait ended without an answer: next step, or the team. */
  private async timeout(tenantId: string, step: StepRow, now: Date): Promise<void> {
    await this.db.tenant(tenantId, async (trx) => {
      const run = await this.confirmations.runById(trx, step.run_id, true);
      if (run.status === "running" && run.step === step.idx) await this.confirmations.advance(trx, tenantId, run, step.idx + 1, now);
      await trx.updateTable("confirmation_steps").set({ status: "done", updated_at: now }).where("id", "=", step.id).execute();
    });
  }

  private async send(tenantId: string, step: StepRow, now: Date): Promise<void> {
    const reply = step.kind === "reply";
    const prepared = await this.db.tenant(tenantId, async (trx) => {
      const run = await this.confirmations.runById(trx, step.run_id);
      // A reply answers the customer whatever the run's state; a cascade send only while its step is current.
      if (!reply && (run.status !== "running" || run.step !== step.idx)) {
        await trx.updateTable("confirmation_steps").set({ status: "cancelled", updated_at: now }).where("id", "=", step.id).execute();
        return null;
      }
      // A send whose response was lost: Meta's status webhook for its key says whether it went out.
      if (step.last_error === UNKNOWN) {
        const seen = await trx.selectFrom("whatsapp_messages").select("wamid").where("step_key", "=", step.idempotency_key).executeTakeFirst();
        const verdict = afterUnknownSend(step.updated_at.getTime(), Boolean(seen), now.getTime(), VERIFY_MS);
        if (verdict === "sent") return { run, message: null, alreadySent: seen!.wamid, wait: false };
        if (verdict === "wait") return { run, message: null, alreadySent: null, wait: true };
      }
      return { run, message: await this.confirmations.facts(trx, tenantId, run), alreadySent: null, wait: false };
    });
    if (!prepared) return;
    if (prepared.alreadySent) return this.finishSend(tenantId, step, prepared.run, now, { ok: true, ref: prepared.alreadySent });
    if (prepared.wait) return this.finishSend(tenantId, step, prepared.run, now, { ok: false, final: false, unknown: true, error: UNKNOWN }, null, step.updated_at);
    const m = await this.messaging.forTenant(tenantId);
    const provider = step.channel === "whatsapp" ? m.whatsapp : m.voice;
    if (!prepared.message || !provider) {
      // No phone on the order, or the vendor was disconnected since the step was planned.
      return this.finishSend(tenantId, step, prepared.run, now, { ok: false, final: true, error: prepared.message ? "channel not connected" : "no phone on the order" });
    }
    try {
      const { ref } = await this.deliver(provider, step, prepared.run, prepared.message.to, prepared.message.facts);
      await this.finishSend(tenantId, step, prepared.run, now, { ok: true, ref }, m.whatsappConnectionId);
    } catch (err) {
      if (isIntegrationError(err) && err.kind === "timeout" && step.channel === "whatsapp" && canChat(provider)) {
        // Outcome unknown (Meta has no idempotency key): check for its status webhook before any re-send.
        return this.finishSend(tenantId, step, prepared.run, now, { ok: false, final: false, unknown: true, error: UNKNOWN });
      }
      const retry = isIntegrationError(err) && err.retryable && step.attempts < MAX_ATTEMPTS;
      await this.finishSend(tenantId, step, prepared.run, now, { ok: false, final: !retry, error: err instanceof Error ? err.message : String(err) });
    }
  }

  private deliver(provider: MessagingProvider & Partial<WhatsAppChat>, step: StepRow, run: RunRow, to: string, f: MessageFacts): Promise<Sent> {
    const key = step.idempotency_key;
    const sign = (action: Parameters<typeof actionId>[2], arg?: string) => actionId(this.config.LINK_SIGNING_KEY, run.id, action, arg);
    if (step.kind === "reply") {
      if (!canChat(provider)) return Promise.reject(new Error("this WhatsApp vendor cannot chat"));
      const name = (step.payload as { message?: string } | null)?.message as ChatMessage;
      if (!CHAT_MESSAGES.includes(name)) return Promise.reject(new Error(`unknown reply ${String(name)}`));
      const c = chatContent(name, f);
      if (c.type === "text") return provider.sendText({ to, key, text: c.text });
      return provider.sendList({ to, key, body: c.body, button: c.button, rows: c.rows.map((r) => ({ id: sign(r.action, r.arg), title: r.title })) });
    }
    if (step.channel === "whatsapp") {
      const quickReplies = TEMPLATE_ACTIONS.map((a) => sign(a));
      if (canChat(provider)) return provider.sendTemplate({ to, key, template: templateName(f.lang), lang: f.lang, params: whatsappParams(f), quickReplies });
      return provider.sendWhatsApp({ to, key, template: templateName(f.lang), lang: f.lang, params: whatsappParams(f), buttons: quickReplies });
    }
    return provider.placeCall({ to, lang: f.lang, prompts: callPrompts(f), digits: { ...CALL_DIGITS }, callbackUrl: `${this.config.PUBLIC_URL.replace(/\/$/, "")}/webhooks/messaging/voice` });
  }

  private async finishSend(tenantId: string, step: StepRow, run: RunRow, now: Date,
    r: { ok: true; ref: string } | { ok: false; final: boolean; error: string; unknown?: boolean }, connectionId: string | null = null, unknownSince?: Date): Promise<void> {
    await this.db.tenant(tenantId, async (trx) => {
      const live = await this.confirmations.runById(trx, run.id, true);
      if (r.ok) {
        await trx.updateTable("confirmation_steps").set({ status: "done", provider_ref: r.ref, last_error: null, updated_at: now }).where("id", "=", step.id).execute();
        this.metrics.confirmationSteps.inc({ channel: step.channel, result: "sent" });
        if (step.channel === "whatsapp") {
          // The transcript; a status webhook may have arrived first and made the row already.
          const kind = step.kind === "reply" ? (step.payload as { message?: string } | null)?.message === "cancel_reasons" ? "list" : "text" : "template";
          const action = step.kind === "reply" ? (step.payload as { message?: string } | null)?.message ?? null : "ask";
          await trx.insertInto("whatsapp_messages").values({
            tenant_id: tenantId, connection_id: connectionId, run_id: live.id, order_id: live.order_id, direction: "out", wamid: r.ref, kind, action, status: "accepted",
            step_key: step.idempotency_key, customer_hash: live.customer_hash, created_at: now, updated_at: now,
          }).onConflict((oc) => oc.columns(["tenant_id", "wamid"]).doUpdateSet({ run_id: live.id, order_id: live.order_id, kind, action, step_key: step.idempotency_key, connection_id: connectionId })).execute();
        }
        if (step.kind === "reply") return;
        if (live.status !== "running" || live.step !== step.idx) return; // answered while we were sending
        const plan = Array.isArray(live.plan) ? (live.plan as Array<{ waitMinutes: number }>) : [];
        const wait = plan[step.idx]?.waitMinutes ?? 120;
        await trx.insertInto("confirmations").values({
          tenant_id: tenantId, order_id: live.order_id, run_id: live.id, channel: step.channel === "call_auto" || step.channel === "voice" ? "voice_ivr" : step.channel, attempt: step.idx + 1, outcome: "pending", started_at: now,
        }).execute();
        await this.confirmations.insertStep(trx, tenantId, live.id, step.idx, step.channel, "timeout", new Date(now.getTime() + wait * 60_000));
        const order = await trx.selectFrom("orders").select("number").where("id", "=", live.order_id).executeTakeFirstOrThrow();
        await this.events.emit(trx, { type: "confirmation.sent", tenantId, entity: { type: "order", id: live.order_id }, actor: { type: "system" }, data: { number: order.number, runId: live.id, channel: step.channel, step: step.idx } });
        return;
      }
      if (!r.final) {
        const since = unknownSince ?? now;
        const at = r.unknown ? new Date(since.getTime() + VERIFY_MS) : new Date(now.getTime() + backoff(step.attempts));
        await trx.updateTable("confirmation_steps").set({ status: "pending", run_at: at, locked_until: null, last_error: r.error.slice(0, 500), updated_at: since }).where("id", "=", step.id).execute();
        this.metrics.confirmationSteps.inc({ channel: step.channel, result: r.unknown ? "unknown" : "retry" });
        return;
      }
      await trx.updateTable("confirmation_steps").set({ status: "dead", last_error: r.error.slice(0, 500), updated_at: now }).where("id", "=", step.id).execute();
      this.metrics.confirmationSteps.inc({ channel: step.channel, result: "failed" });
      if (step.kind !== "reply" && live.status === "running" && live.step === step.idx) await this.confirmations.advance(trx, tenantId, live, step.idx + 1, now);
    });
  }
}

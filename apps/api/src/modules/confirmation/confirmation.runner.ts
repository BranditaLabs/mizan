import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { sql } from "kysely";
import { asWorker } from "@mizan/db";
import { isIntegrationError, type MessagingProvider } from "@mizan/engine";
import { APP_CONFIG, runsWorkerInProcess, type AppConfig } from "../../platform/config.js";
import { Database } from "../../platform/db/database.js";
import { EventsService } from "../../platform/events/events.service.js";
import { MetricsService } from "../../platform/metrics/metrics.service.js";
import { ConfirmationService, type RunRow } from "./confirmation.service.js";
import type { AutomatedChannel } from "./confirmation.settings.js";
import { BUTTONS, CALL_DIGITS, callPrompts, smsText, WHATSAPP_TEMPLATE, whatsappParams, type MessageFacts } from "./messages.js";
import { MessagingRegistry } from "./messaging.registry.js";

interface StepRow { id: string; run_id: string; idx: number; channel: string; kind: string; attempts: number }

const LEASE_MS = 2 * 60_000;
const MAX_ATTEMPTS = 5;
/** Retry delays for a vendor that failed for now (1, 2, 4, 8 minutes). */
const backoff = (attempt: number) => Math.min(8, 2 ** (attempt - 1)) * 60_000;

/**
 * Runs due confirmation steps (E6-7). For each store with due steps: claim them in a short
 * transaction, call the vendor outside any transaction, then record the result in a second one.
 * A send schedules its wait; a wait that ends unanswered moves to the next step. Retryable vendor
 * errors back off; a refused number or exhausted retries move on to the next channel.
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

  /** One pass over every store with due steps. Returns how many steps ran. */
  async runOnce(now = new Date()): Promise<number> {
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
      const rows = await trx.selectFrom("confirmation_steps").select(["id", "run_id", "idx", "channel", "kind", "attempts"])
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

  /** The wait ended without an answer: next step, or an agent. */
  private async timeout(tenantId: string, step: StepRow, now: Date): Promise<void> {
    await this.db.tenant(tenantId, async (trx) => {
      const run = await this.confirmations.runById(trx, step.run_id, true);
      if (run.status === "running" && run.step === step.idx) await this.confirmations.advance(trx, tenantId, run, step.idx + 1, now);
      await trx.updateTable("confirmation_steps").set({ status: "done", updated_at: now }).where("id", "=", step.id).execute();
    });
  }

  private async send(tenantId: string, step: StepRow, now: Date): Promise<void> {
    const channel = step.channel as AutomatedChannel;
    const prepared = await this.db.tenant(tenantId, async (trx) => {
      const run = await this.confirmations.runById(trx, step.run_id);
      if (run.status !== "running" || run.step !== step.idx) {
        await trx.updateTable("confirmation_steps").set({ status: "cancelled", updated_at: now }).where("id", "=", step.id).execute();
        return null;
      }
      return { run, message: await this.confirmations.facts(trx, tenantId, run) };
    });
    if (!prepared) return;
    const provider = this.messaging.providerFor(tenantId);
    if (!prepared.message || !provider?.channels.has(channel)) {
      // No phone on the order, or the vendor was disconnected since the step was planned.
      return this.finishSend(tenantId, step, prepared.run, now, { ok: false, final: true, error: prepared.message ? "channel not connected" : "no phone on the order" });
    }
    try {
      const { ref } = await this.deliver(provider, channel, prepared.message.to, prepared.message.facts);
      await this.finishSend(tenantId, step, prepared.run, now, { ok: true, ref });
    } catch (err) {
      const retry = isIntegrationError(err) && err.retryable && step.attempts < MAX_ATTEMPTS;
      await this.finishSend(tenantId, step, prepared.run, now, { ok: false, final: !retry, error: err instanceof Error ? err.message : String(err) });
    }
  }

  private deliver(provider: MessagingProvider, channel: AutomatedChannel, to: string, f: MessageFacts) {
    if (channel === "whatsapp") return provider.sendWhatsApp({ to, template: WHATSAPP_TEMPLATE, lang: f.lang, params: whatsappParams(f), buttons: [...BUTTONS], url: f.link });
    if (channel === "sms") return provider.sendSms({ to, text: smsText(f) });
    return provider.placeCall({ to, lang: f.lang, prompts: callPrompts(f), digits: { ...CALL_DIGITS }, callbackUrl: `${this.config.PUBLIC_URL.replace(/\/$/, "")}/webhooks/messaging/voice` });
  }

  private async finishSend(tenantId: string, step: StepRow, run: RunRow, now: Date, r: { ok: true; ref: string } | { ok: false; final: boolean; error: string }): Promise<void> {
    await this.db.tenant(tenantId, async (trx) => {
      const live = await this.confirmations.runById(trx, run.id, true);
      if (r.ok) {
        await trx.updateTable("confirmation_steps").set({ status: "done", provider_ref: r.ref, last_error: null, updated_at: now }).where("id", "=", step.id).execute();
        this.metrics.confirmationSteps.inc({ channel: step.channel, result: "sent" });
        if (live.status !== "running" || live.step !== step.idx) return; // answered while we were sending
        const wait = (Array.isArray(live.plan) ? (live.plan as Array<{ waitMinutes: number }>)[step.idx]?.waitMinutes : undefined) ?? 120;
        await trx.insertInto("confirmations").values({
          tenant_id: tenantId, order_id: live.order_id, run_id: live.id, channel: step.channel === "voice" ? "voice_ivr" : step.channel, attempt: step.idx + 1, outcome: "pending", started_at: now,
        }).execute();
        await this.confirmations.insertStep(trx, tenantId, live.id, step.idx, step.channel, "timeout", new Date(now.getTime() + wait * 60_000));
        const order = await trx.selectFrom("orders").select("number").where("id", "=", live.order_id).executeTakeFirstOrThrow();
        await this.events.emit(trx, { type: "confirmation.sent", tenantId, entity: { type: "order", id: live.order_id }, actor: { type: "system" }, data: { number: order.number, runId: live.id, channel: step.channel, step: step.idx } });
        return;
      }
      if (!r.final) {
        await trx.updateTable("confirmation_steps").set({ status: "pending", run_at: new Date(now.getTime() + backoff(step.attempts)), locked_until: null, last_error: r.error.slice(0, 500), updated_at: now }).where("id", "=", step.id).execute();
        this.metrics.confirmationSteps.inc({ channel: step.channel, result: "retry" });
        return;
      }
      await trx.updateTable("confirmation_steps").set({ status: "dead", last_error: r.error.slice(0, 500), updated_at: now }).where("id", "=", step.id).execute();
      this.metrics.confirmationSteps.inc({ channel: step.channel, result: "failed" });
      if (live.status === "running" && live.step === step.idx) await this.confirmations.advance(trx, tenantId, live, step.idx + 1, now);
    });
  }
}

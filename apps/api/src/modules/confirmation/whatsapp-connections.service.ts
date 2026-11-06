import { Inject, Injectable, Logger } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import { asWorker, tenantQueryClient, trxQueryClient, type DB } from "@mizan/db";
import { isIntegrationError, OutboxWorker, SqlStore, type Runtime, type TemplateInfo } from "@mizan/engine";
import { auditActor, AuditService } from "../../platform/audit/audit.service.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { Database } from "../../platform/db/database.js";
import { EventsService } from "../../platform/events/events.service.js";
import { ProblemError } from "../../platform/http/problem.js";
import { SecretsService } from "../../platform/secrets/secrets.service.js";
import { toConnectionView, type ConnectionView } from "../connections/connections.dto.js";
import { WebhookRouter } from "../../integrations/webhook-router.js";
import { ENGINE_RUNTIME, type RuntimeFactory } from "../../integrations/engine-runtime.js";
import { confirmationSettings } from "./confirmation.settings.js";
import { MessagingRegistry, templatesOf } from "./messaging.registry.js";
import {
  AR_VARIANTS, chosenTemplate, effectiveTemplate, statusOf, submittable, TEMPLATE_NAMES, TEMPLATE_SPECS, TEMPLATE_VARIANTS,
  type TemplateStatus, type TemplateVariant,
} from "./templates.js";

const COLUMNS = ["id", "kind", "provider", "external_account", "display_name", "status", "status_reason", "config", "updated_at"] as const;
/** A failed check (Meta down) is tried again after this long. */
const RECHECK_MS = 60_000;
/** While a template is in Meta's review, the number is checked again this often (E6-16d). */
const PENDING_RECHECK_MS = 10 * 60_000;
/** The outbox job that submits a template (E6-16d); its rows live in mz_outbox under the scope `whatsapp:<connection id>`. */
export const TEMPLATE_JOB = "whatsapp.createTemplate";
export const WHATSAPP_SCOPE = "whatsapp:";
const STATES = ["pending", "active", "needs_attention"] as const;

type Outcome = { status: "active" | "needs_attention" | "pending"; reason: string | null; templates?: Record<string, string> };
interface Creds { phoneNumberId: string; wabaId: string; accessToken: string }

/**
 * The store's WhatsApp number (E6-10; Embedded Signup comes with E6-4b). The owner pastes the
 * number's ids and a token from Meta; the token is stored encrypted, then checked in the
 * background (no provider call in a request, rule 3): the token must work and a confirmation
 * template in the store's language must be approved by Meta. Until then confirmation skips
 * WhatsApp and goes to the team. E6-16d: the owner submits the templates from Mizan (an outbox
 * job), and the number is checked again while any of them is in review.
 */
@Injectable()
export class WhatsAppConnections {
  private readonly logger = new Logger("WhatsApp");

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(SecretsService) private readonly secrets: SecretsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(MessagingRegistry) private readonly registry: MessagingRegistry,
    @Inject(WebhookRouter) private readonly router: WebhookRouter,
    @Inject(ENGINE_RUNTIME) private readonly runtime: RuntimeFactory,
  ) {}

  async save(auth: AuthContext, body: { phoneNumberId: string; wabaId: string; accessToken: string }): Promise<ConnectionView> {
    const tenantId = auth.tenant!.id;
    const by = auditActor(auth);
    const elsewhere = await asWorker(this.db.kysely, (trx) => trx.selectFrom("connections").select("tenant_id")
      .where("provider", "=", "whatsapp_cloud").where("external_account", "=", body.phoneNumberId).where("tenant_id", "!=", tenantId).where("status", "!=", "disconnected").executeTakeFirst());
    if (elsewhere) throw new ProblemError(409, "number_connected_elsewhere", "this WhatsApp number is connected to another store");
    const view = await this.db.tenant(tenantId, async (trx) => {
      const credential = JSON.stringify({ accessToken: body.accessToken });
      const config = JSON.stringify({ wabaId: body.wabaId });
      const existing = await trx.selectFrom("connections").select(["id", "secret_ref"]).where("kind", "=", "whatsapp").where("provider", "=", "whatsapp_cloud").orderBy("created_at", "desc").executeTakeFirst();
      let id: string;
      if (existing?.secret_ref) {
        await this.secrets.rotate(trx, tenantId, existing.secret_ref, credential, by);
        id = existing.id;
        await trx.updateTable("connections").set({ external_account: body.phoneNumberId, config, status: "pending", status_reason: null, updated_at: new Date() }).where("id", "=", id).execute();
      } else {
        const ref = await this.secrets.create(trx, tenantId, credential, by);
        id = (await trx.insertInto("connections").values({
          tenant_id: tenantId, kind: "whatsapp", provider: "whatsapp_cloud", external_account: body.phoneNumberId, display_name: "WhatsApp", secret_ref: ref, config, status: "pending",
        }).returning("id").executeTakeFirstOrThrow()).id;
      }
      await this.audit.record(trx, { action: "connection.key_saved", tenantId, entity: { type: "connection", id }, after: { provider: "whatsapp_cloud", status: "pending" }, ...by });
      return toConnectionView(await trx.selectFrom("connections").select([...COLUMNS]).where("id", "=", id).executeTakeFirstOrThrow());
    });
    this.registry.invalidate(tenantId);
    this.router.forget(view.id);
    return view;
  }

  /** Check again (templates approved since, token replaced in Meta). */
  async recheck(auth: AuthContext): Promise<ConnectionView> {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const c = await trx.selectFrom("connections").select([...COLUMNS]).where("kind", "=", "whatsapp").where("provider", "=", "whatsapp_cloud").orderBy("created_at", "desc").executeTakeFirst();
      if (!c) throw new ProblemError(404, "not_found", "no WhatsApp number connected");
      const config = { ...(c.config as Record<string, unknown>), checkedAt: null };
      await trx.updateTable("connections").set({ status: "pending", config: JSON.stringify(config), updated_at: new Date() }).where("id", "=", c.id).execute();
      return toConnectionView({ ...c, status: "pending", config });
    });
  }

  /**
   * Background (the confirmation runner): check numbers waiting for it, and numbers with a
   * template in Meta's review (or just submitted) when their re-check is due.
   */
  async checkWaiting(now = new Date()): Promise<number> {
    const waiting = await asWorker(this.db.kysely, (trx) => trx.selectFrom("connections").select(["id", "tenant_id", "status"])
      .where("provider", "=", "whatsapp_cloud")
      .where((eb) => eb.or([
        eb("status", "=", "pending"),
        eb.and([eb("status", "in", ["active", "needs_attention"]), eb("check_after", "<=", now)]),
      ])).limit(20).execute());
    let n = 0;
    for (const w of waiting) {
      const was = w.status as (typeof STATES)[number];
      const prepared = await this.db.tenant(w.tenant_id, async (trx) => {
        const c = await trx.selectFrom("connections").select(["external_account", "secret_ref", "config"]).where("id", "=", w.id).executeTakeFirst();
        const cfg = (c?.config ?? {}) as { wabaId?: string; checkedAt?: string | null };
        if (!c?.secret_ref || !c.external_account || !cfg.wabaId) return null;
        if (was === "pending" && cfg.checkedAt && now.getTime() - Date.parse(cfg.checkedAt) < RECHECK_MS) return null;
        const token = (JSON.parse((await this.secrets.read(trx, w.tenant_id, c.secret_ref)).reveal()) as { accessToken: string }).accessToken;
        const t = await trx.selectFrom("tenants").select(["locale", "settings"]).where("id", "=", w.tenant_id).executeTakeFirstOrThrow();
        const lang = (t.locale?.startsWith("en") ? "en" : "ar") as "ar" | "en";
        return { creds: { phoneNumberId: c.external_account, wabaId: cfg.wabaId, accessToken: token }, lang, choice: chosenTemplate(lang, confirmationSettings(t.settings).script) };
      });
      if (!prepared) continue;
      n++;
      let outcome: Outcome;
      try {
        const found = await this.registry.connector(w.tenant_id, prepared.creds).templates([...TEMPLATE_NAMES]);
        outcome = judge(found, prepared.lang, prepared.choice);
      } catch (err) {
        const kind = isIntegrationError(err) ? err.kind : "unknown";
        outcome = kind === "auth" ? { status: "needs_attention", reason: "token_refused" }
          : kind === "permission" || kind === "not_found" ? { status: "needs_attention", reason: "token_lacks_permission" }
          : { status: "pending", reason: null }; // Meta unavailable: try again shortly
        this.logger.warn({ tenantId: w.tenant_id, kind }, "WhatsApp check failed");
      }
      await this.record(w.tenant_id, w.id, was, outcome, now);
    }
    return n;
  }

  private async record(tenantId: string, id: string, was: (typeof STATES)[number], o: Outcome, now: Date) {
    await this.db.tenant(tenantId, async (trx) => {
      const c = await trx.selectFrom("connections").select(["status", "config"]).where("id", "=", id).forUpdate().executeTakeFirstOrThrow();
      if (c.status !== was) return; // changed meanwhile
      const prev = c.config as Record<string, unknown>;
      // Meta unavailable on a number already judged: its state stays, the check comes back shortly.
      const unavailable = o.status === "pending" && was !== "pending";
      const status = unavailable ? was : o.status;
      const templates = o.templates ?? templatesOf(prev) ?? {};
      const inReview = TEMPLATE_VARIANTS.some((v) => statusOf(templates, v) === "PENDING");
      const checkAfter = unavailable ? new Date(now.getTime() + RECHECK_MS) : inReview ? new Date(now.getTime() + PENDING_RECHECK_MS) : null;
      const config = {
        ...prev, checkedAt: now.toISOString(), ...(o.templates ? { templates: o.templates } : {}), ...(status === "active" && was !== "active" ? { verifiedAt: now.toISOString() } : {}),
      };
      await trx.updateTable("connections").set({ status, ...(unavailable ? {} : { status_reason: o.reason }), config: JSON.stringify(config), check_after: checkAfter, updated_at: now }).where("id", "=", id).execute();
      if (status === "pending" || status === was) return;
      const entity = { type: "connection", id };
      const by = { actor: { type: "system" as const } };
      if (status === "active") {
        await this.audit.record(trx, { action: "connection.connected", tenantId, entity, before: { status: was }, after: { status: "active" }, ...by });
        await this.events.emit(trx, { type: "connection.connected", tenantId, entity, data: { provider: "whatsapp_cloud", kind: "whatsapp", reconnected: was !== "pending" }, actor: { type: "engine" } });
      } else {
        await this.audit.record(trx, { action: "connection.needs_attention", tenantId, entity, before: { status: was }, after: { status, reason: o.reason }, ...by });
        await this.events.emit(trx, { type: "connection.needs_attention", tenantId, entity, data: { provider: "whatsapp_cloud", kind: "whatsapp", reason: o.reason }, actor: { type: "engine" } });
      }
    });
    this.registry.invalidate(tenantId);
  }

  // ───────────── E6-16d: the templates, and submitting them to Meta ─────────────

  /**
   * The owner sends a template to Meta for review (E6-16d): an outbox job (rule 3) keyed
   * `wa-template:<connection>:<name>`, so pressing twice is one job; a template submitted again after
   * a rejection gets a key of its own. Audited; `whatsapp.template_submitted`.
   */
  async submit(auth: AuthContext, variant: string, now = Date.now()): Promise<{ variant: TemplateVariant; name: string; queued: boolean }> {
    if (!(TEMPLATE_VARIANTS as readonly string[]).includes(variant)) throw new ProblemError(422, "validation_failed", "unknown template", [{ path: "variant", code: "invalid_enum_value" }]);
    const v = variant as TemplateVariant;
    const tenantId = auth.tenant!.id;
    const name = TEMPLATE_SPECS[v].name;
    return this.db.tenant(tenantId, async (trx) => {
      const c = await currentNumber(trx);
      if (!c) throw new ProblemError(409, "whatsapp_not_connected", "connect the store's WhatsApp number first");
      const store = new SqlStore(trxQueryClient(trx), { tenantId, store: `${WHATSAPP_SCOPE}${c.id}`, connections: { whatsapp: c.id } });
      const base = `wa-template:${c.id}:${name}`;
      const earlier = (await store.jobs({ kind: TEMPLATE_JOB })).filter((j) => j.idempotencyKey === base || j.idempotencyKey.startsWith(`${base}:`));
      if (earlier.some((j) => j.status === "pending" || j.status === "running")) return { variant: v, name, queued: false };
      const key = earlier.length ? `${base}:${earlier.length + 1}` : base;
      const { created } = await store.enqueue({ kind: TEMPLATE_JOB, connection: "whatsapp", payload: { variant: v, name }, idempotencyKey: key }, now);
      if (created) {
        const entity = { type: "connection", id: c.id };
        await this.audit.record(trx, { action: "whatsapp.template_submitted", tenantId, entity, after: { variant: v, template: name }, ...auditActor(auth) });
        await this.events.emit(trx, { type: "whatsapp.template_submitted", tenantId, entity, data: { variant: v, template: name }, actor: { type: "user", id: auth.user.id } });
      }
      return { variant: v, name, queued: created };
    });
  }

  /**
   * Background (the confirmation runner): due template jobs, per number. The engine's outbox worker
   * runs them (retries with backoff, dead letter); the job creates the template unless it exists
   * (the connector looks it up first), stores what Meta says, and brings the number's check forward.
   */
  async runTemplateJobs(now = new Date()): Promise<number> {
    const t = now.getTime();
    const due = await asWorker(this.db.kysely, (trx) => sql<{ tenant_id: string; scope: string }>`
      SELECT DISTINCT tenant_id, scope FROM mz_outbox
      WHERE scope LIKE ${`${WHATSAPP_SCOPE}%`} AND next_attempt_at <= ${t} AND (status = 'pending' OR (status = 'running' AND locked_until < ${t}))
      LIMIT 50`.execute(trx));
    let ran = 0;
    for (const { tenant_id: tenantId, scope } of due.rows) {
      const connectionId = scope.slice(WHATSAPP_SCOPE.length);
      const creds = await this.db.tenant(tenantId, (trx) => this.credsOf(trx, tenantId, connectionId));
      const store = new SqlStore(tenantQueryClient(this.db.kysely, tenantId), { tenantId, store: scope, connections: { whatsapp: connectionId } });
      const base = this.runtime(tenantId);
      // Job times are wall-clock (the runner's `now`): the worker claims and reschedules on it.
      const rt: Runtime = { ...base, clock: { now: () => t, sleep: (ms, signal) => base.clock.sleep(ms, signal) } };
      const worker = new OutboxWorker(store, rt, {
        [TEMPLATE_JOB]: async (job) => {
          if (!creds) throw new ProblemError(409, "whatsapp_not_connected", "the WhatsApp number was disconnected");
          const { variant } = job.payload as { variant: TemplateVariant };
          const spec = TEMPLATE_SPECS[variant];
          const created = await this.registry.connector(tenantId, creds).createTemplate({
            name: spec.name, language: spec.lang, category: spec.category, body: spec.body, example: [...spec.example], buttons: [...spec.buttons],
          }, { resubmitRejected: true });
          await this.stored(tenantId, connectionId, spec.name, created.status, now);
        },
      });
      ran += await worker.tick();
    }
    return ran;
  }

  /** What Meta said about a submitted template, kept with the others; the number's check runs again soon. */
  private async stored(tenantId: string, connectionId: string, name: string, status: string, now: Date) {
    await this.db.tenant(tenantId, async (trx) => {
      const c = await trx.selectFrom("connections").select(["config"]).where("id", "=", connectionId).forUpdate().executeTakeFirst();
      if (!c) return;
      const prev = c.config as Record<string, unknown>;
      const config = { ...prev, templates: { ...(templatesOf(prev) ?? {}), [name]: status } };
      await trx.updateTable("connections").set({ config: JSON.stringify(config), check_after: now, updated_at: now }).where("id", "=", connectionId).execute();
    });
    this.registry.invalidate(tenantId);
  }

  private async credsOf(trx: Transaction<DB>, tenantId: string, connectionId: string): Promise<Creds | null> {
    const c = await trx.selectFrom("connections").select(["external_account", "secret_ref", "config", "status"]).where("id", "=", connectionId).executeTakeFirst();
    const wabaId = (c?.config as { wabaId?: unknown } | null)?.wabaId;
    if (!c?.secret_ref || !c.external_account || typeof wabaId !== "string" || c.status === "disconnected") return null;
    const token = (JSON.parse((await this.secrets.read(trx, tenantId, c.secret_ref)).reveal()) as { accessToken?: string }).accessToken;
    return token ? { phoneNumberId: c.external_account, wabaId, accessToken: token } : null;
  }
}

/** The store's WhatsApp number, whatever its state (not disconnected). */
async function currentNumber(trx: Transaction<DB>) {
  return (await trx.selectFrom("connections").select(["id", "status", "config"]).where("kind", "=", "whatsapp").where("provider", "=", "whatsapp_cloud")
    .where("status", "!=", "disconnected").orderBy("created_at", "desc").executeTakeFirst()) ?? null;
}

export interface TemplateState { variant: TemplateVariant; name: string; lang: "ar" | "en"; status: TemplateStatus; effective: boolean; submittable: boolean }

/**
 * E6-16d: each first-message template as Meta last reported it (UNKNOWN without a number), the one
 * the store's orders get now (the chosen one, or the approved fallback), and which can be submitted.
 */
export async function templateStates(trx: Transaction<DB>, tenantId: string): Promise<{ templates: TemplateState[]; lang: "ar" | "en"; statuses: Record<string, string> | null }> {
  const c = await currentNumber(trx);
  const t = await trx.selectFrom("tenants").select(["locale", "settings"]).where("id", "=", tenantId).executeTakeFirstOrThrow();
  const lang = (t.locale?.startsWith("en") ? "en" : "ar") as "ar" | "en";
  const statuses = c ? templatesOf(c.config) : null;
  const effective = effectiveTemplate(chosenTemplate(lang, confirmationSettings(t.settings).script), lang, statuses).variant;
  const templates = TEMPLATE_VARIANTS.map((variant) => {
    const status: TemplateStatus = c ? statusOf(statuses, variant) : "UNKNOWN";
    return { variant, name: TEMPLATE_SPECS[variant].name, lang: TEMPLATE_SPECS[variant].lang, status, effective: variant === effective, submittable: Boolean(c) && submittable(status) };
  });
  return { templates, lang, statuses: c ? statuses ?? {} : null };
}

/**
 * Active when Meta approved at least one template in the store's language (Arabic: any of the
 * three; English: `en`); else needs attention, with the chosen one's state as the reason.
 */
export function judge(found: TemplateInfo[], lang: "ar" | "en", choice: TemplateVariant): Outcome & { templates: Record<string, string> } {
  const templates = Object.fromEntries(found.filter((t) => TEMPLATE_NAMES.includes(t.name)).map((t) => [t.name, t.status]));
  const candidates: readonly TemplateVariant[] = lang === "en" ? ["en"] : AR_VARIANTS;
  if (candidates.some((v) => statusOf(templates, v) === "APPROVED")) return { status: "active", reason: null, templates };
  const chosen = statusOf(templates, lang === "en" ? "en" : choice === "en" ? "ar_egyptian" : choice);
  return { status: "needs_attention", reason: chosen === "PENDING" ? "template_pending" : chosen === "MISSING" ? "template_missing" : "template_rejected", templates };
}

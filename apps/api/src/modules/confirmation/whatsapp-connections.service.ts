import { Inject, Injectable, Logger } from "@nestjs/common";
import { asWorker } from "@mizan/db";
import { isIntegrationError, type TemplateInfo } from "@mizan/engine";
import { auditActor, AuditService } from "../../platform/audit/audit.service.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { Database } from "../../platform/db/database.js";
import { EventsService } from "../../platform/events/events.service.js";
import { ProblemError } from "../../platform/http/problem.js";
import { SecretsService } from "../../platform/secrets/secrets.service.js";
import { toConnectionView, type ConnectionView } from "../connections/connections.dto.js";
import { WebhookRouter } from "../../integrations/webhook-router.js";
import { TEMPLATES, templateName } from "./messages.js";
import { MessagingRegistry } from "./messaging.registry.js";

const COLUMNS = ["id", "kind", "provider", "external_account", "status", "status_reason", "config", "updated_at"] as const;
/** A failed check (Meta down) is tried again after this long. */
const RECHECK_MS = 60_000;

/**
 * The store's WhatsApp number (E6-10; Embedded Signup comes with E6-4b). The owner pastes the
 * number's ids and a token from Meta; the token is stored encrypted, then checked in the
 * background (no provider call in a request, rule 3): the token must work and the confirmation
 * template in the store's language must be approved by Meta. Until then confirmation skips
 * WhatsApp and goes to the team.
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

  /** Background (the confirmation runner): check numbers waiting for it. */
  async checkWaiting(now = new Date()): Promise<number> {
    const waiting = await asWorker(this.db.kysely, (trx) => trx.selectFrom("connections").select(["id", "tenant_id"])
      .where("provider", "=", "whatsapp_cloud").where("status", "=", "pending").limit(20).execute());
    let n = 0;
    for (const w of waiting) {
      const prepared = await this.db.tenant(w.tenant_id, async (trx) => {
        const c = await trx.selectFrom("connections").select(["external_account", "secret_ref", "config"]).where("id", "=", w.id).executeTakeFirst();
        const cfg = (c?.config ?? {}) as { wabaId?: string; checkedAt?: string | null };
        if (!c?.secret_ref || !c.external_account || !cfg.wabaId) return null;
        if (cfg.checkedAt && now.getTime() - Date.parse(cfg.checkedAt) < RECHECK_MS) return null;
        const token = (JSON.parse((await this.secrets.read(trx, w.tenant_id, c.secret_ref)).reveal()) as { accessToken: string }).accessToken;
        const t = await trx.selectFrom("tenants").select("locale").where("id", "=", w.tenant_id).executeTakeFirstOrThrow();
        return { phoneNumberId: c.external_account, wabaId: cfg.wabaId, accessToken: token, lang: (t.locale?.startsWith("en") ? "en" : "ar") as "ar" | "en" };
      });
      if (!prepared) continue;
      n++;
      let outcome: { status: "active" | "needs_attention" | "pending"; reason: string | null; templates?: Record<string, string> };
      try {
        const found = await this.registry.connector(w.tenant_id, prepared).templates([...TEMPLATES]);
        outcome = this.judge(found, templateName(prepared.lang));
      } catch (err) {
        const kind = isIntegrationError(err) ? err.kind : "unknown";
        outcome = kind === "auth" ? { status: "needs_attention", reason: "token_refused" }
          : kind === "permission" || kind === "not_found" ? { status: "needs_attention", reason: "token_lacks_permission" }
          : { status: "pending", reason: null }; // Meta unavailable: try again shortly
        this.logger.warn({ tenantId: w.tenant_id, kind }, "WhatsApp check failed");
      }
      await this.record(w.tenant_id, w.id, outcome, now);
    }
    return n;
  }

  private judge(found: TemplateInfo[], required: string): { status: "active" | "needs_attention"; reason: string | null; templates: Record<string, string> } {
    const templates = Object.fromEntries(found.map((t) => [t.name, t.status]));
    const status = templates[required];
    if (status === "APPROVED") return { status: "active", reason: null, templates };
    return { status: "needs_attention", reason: status === "PENDING" || status === "IN_APPEAL" ? "template_pending" : status ? "template_rejected" : "template_missing", templates };
  }

  private async record(tenantId: string, id: string, o: { status: "active" | "needs_attention" | "pending"; reason: string | null; templates?: Record<string, string> }, now: Date) {
    await this.db.tenant(tenantId, async (trx) => {
      const c = await trx.selectFrom("connections").select(["status", "config"]).where("id", "=", id).forUpdate().executeTakeFirstOrThrow();
      if (c.status !== "pending") return; // changed meanwhile
      const config = { ...(c.config as Record<string, unknown>), checkedAt: now.toISOString(), ...(o.templates ? { templates: o.templates } : {}), ...(o.status === "active" ? { verifiedAt: now.toISOString() } : {}) };
      await trx.updateTable("connections").set({ status: o.status, status_reason: o.reason, config: JSON.stringify(config), updated_at: now }).where("id", "=", id).execute();
      if (o.status === "pending") return;
      const entity = { type: "connection", id };
      const by = { actor: { type: "system" as const } };
      if (o.status === "active") {
        await this.audit.record(trx, { action: "connection.connected", tenantId, entity, before: { status: "pending" }, after: { status: "active" }, ...by });
        await this.events.emit(trx, { type: "connection.connected", tenantId, entity, data: { provider: "whatsapp_cloud", kind: "whatsapp", reconnected: false }, actor: { type: "engine" } });
      } else {
        await this.audit.record(trx, { action: "connection.needs_attention", tenantId, entity, before: { status: "pending" }, after: { status: o.status, reason: o.reason }, ...by });
        await this.events.emit(trx, { type: "connection.needs_attention", tenantId, entity, data: { provider: "whatsapp_cloud", kind: "whatsapp", reason: o.reason }, actor: { type: "engine" } });
      }
    });
    this.registry.invalidate(tenantId);
  }
}

import { Inject, Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import type { DB } from "@mizan/db";
import { missingScopes } from "@mizan/engine";
import { fromMinor } from "@mizan/shared";
import { auditActor, AuditService } from "../../platform/audit/audit.service.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { APP_CONFIG, type AppConfig } from "../../platform/config.js";
import { Database } from "../../platform/db/database.js";
import { EngineRegistry } from "../../integrations/engine-registry.js";
import type { Onboarding, OnboardingSettings, UpdateOnboardingBody } from "./onboarding.dto.js";
import { ProductEventsService } from "./product-events.service.js";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Scopes Mizan now asks for that the store approved before they were added (config.scopes, set on install). */
function grantedMissing(config: unknown, required: string[]): string[] {
  const scopes = (config as { scopes?: unknown } | null)?.scopes;
  return Array.isArray(scopes) ? missingScopes(required, scopes.filter((x): x is string => typeof x === "string")) : [];
}

/**
 * Where a store is in its setup (E4-5): connect the store → courier → product costs → first order.
 * Read from the connections, catalogue, orders and product events; skips and the hidden card live in
 * tenants.settings.onboarding.
 */
@Injectable()
export class OnboardingService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(EngineRegistry) private readonly engines: EngineRegistry,
    @Inject(ProductEventsService) private readonly productEvents: ProductEventsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async get(tenantId: string): Promise<Onboarding> {
    const state = await this.db.tenant(tenantId, (trx) => this.read(trx, tenantId));
    // The import progress lives in the engine's store; reading it needs a connected store.
    let imported: Onboarding["steps"]["store"]["import"] = null;
    if (state.store) {
      try {
        const b = await (await this.engines.get(tenantId, state.store.id)).engine.backfillStatus();
        if (b) imported = { status: b.status, phase: b.phase, orders: b.orders, products: b.products };
      } catch {
        /* not buildable yet (credentials being replaced): show no progress */
      }
    }
    const s = state;
    const courierStatus = !s.courier ? (s.settings.skipped?.courier ? "skipped" : "todo")
      : s.courier.status === "active" ? "done" : s.courier.status === "needs_attention" ? "needs_attention" : s.courier.status === "pending" ? "checking"
      : s.settings.skipped?.courier ? "skipped" : "todo";
    const costsStatus = s.variants > 0 && s.missingCost === 0 ? "done" : s.settings.skipped?.costs ? "skipped" : "todo";
    const m = s.milestones;
    const steps: Onboarding["steps"] = {
      store: {
        status: s.store ? "done" : "todo", connectionId: s.store?.id ?? null, shop: s.store?.external_account ?? null, import: imported,
        missingScopes: s.store ? grantedMissing(s.store.config, this.config.SHOPIFY_SCOPES.split(",")) : [],
      },
      courier: { status: courierStatus, provider: s.courier?.provider ?? null, reason: s.courier?.status === "needs_attention" ? s.courier.status_reason : null },
      costs: { status: costsStatus, variants: s.variants, missingCost: s.missingCost },
      firstOrder: s.firstOrder
        ? { status: "done", orderId: s.firstOrder.id, number: s.firstOrder.number, total: fromMinor(BigInt(s.firstOrder.total_minor), s.firstOrder.currency), at: iso(s.firstOrder.created_at) }
        : { status: "waiting", orderId: null, number: null, total: null, at: null },
    };
    return {
      steps,
      milestones: { signup: iso(m.signup), storeConnected: iso(m.store_connected), courierConnected: iso(m.courier_connected), costsEntered: iso(m.costs_entered), firstOrderSynced: iso(m.first_order_synced) },
      timeToFirstValueS: m.signup && m.first_order_synced ? Math.max(0, Math.round((m.first_order_synced.getTime() - m.signup.getTime()) / 1000)) : null,
      complete: steps.store.status === "done" && ["done", "skipped"].includes(steps.courier.status) && ["done", "skipped"].includes(steps.costs.status) && steps.firstOrder.status === "done",
      dismissed: Boolean(s.settings.dismissedAt),
    };
  }

  async update(auth: AuthContext, body: UpdateOnboardingBody): Promise<Onboarding> {
    const tenantId = auth.tenant!.id;
    await this.db.tenant(tenantId, async (trx) => {
      const t = await trx.selectFrom("tenants").select("settings").where("id", "=", tenantId).forUpdate().executeTakeFirstOrThrow();
      const settings = (t.settings ?? {}) as Record<string, unknown>;
      const before = (settings.onboarding ?? {}) as OnboardingSettings;
      const after: OnboardingSettings = {
        skipped: { ...before.skipped, ...body.skip },
        dismissedAt: body.dismissed === undefined ? before.dismissedAt ?? null : body.dismissed ? new Date().toISOString() : null,
      };
      await trx.updateTable("tenants").set({ settings: JSON.stringify({ ...settings, onboarding: after }), updated_at: new Date() }).where("id", "=", tenantId).execute();
      await this.audit.record(trx, { action: "onboarding.updated", tenantId, before: { ...before }, after: { ...after }, ...auditActor(auth) });
      for (const [step, on] of Object.entries(body.skip ?? {})) {
        if (on && !before.skipped?.[step as "courier" | "costs"]) await this.productEvents.record(trx, tenantId, { name: "onboarding_step_skipped", userId: auth.user.id, data: { step } });
      }
    });
    return this.get(tenantId);
  }

  private async read(trx: Transaction<DB>, tenantId: string) {
    const t = await trx.selectFrom("tenants").select("settings").where("id", "=", tenantId).executeTakeFirstOrThrow();
    const settings = ((t.settings ?? {}) as { onboarding?: OnboardingSettings }).onboarding ?? {};
    const connections = await trx.selectFrom("connections").select(["id", "kind", "provider", "external_account", "status", "status_reason", "config"])
      .where("status", "!=", "disconnected").orderBy("created_at").execute();
    const counts = await trx.selectFrom("variants as v").innerJoin("products as p", "p.id", "v.product_id").where("p.status", "!=", "archived")
      .select([sql<string>`count(*)`.as("variants"), sql<string>`count(*) filter (where v.cogs_set_at is null)`.as("missing")]).executeTakeFirstOrThrow();
    const firstOrder = await trx.selectFrom("orders").select(["id", "number", "total_minor", "currency", "created_at"]).orderBy("created_at").orderBy("id").limit(1).executeTakeFirst();
    return {
      settings,
      store: connections.find((c) => c.kind === "store") ?? null,
      courier: connections.find((c) => c.kind === "courier") ?? null,
      variants: Number(counts.variants), missingCost: Number(counts.missing),
      firstOrder: firstOrder ?? null,
      milestones: await this.productEvents.milestones(trx),
    };
  }
}

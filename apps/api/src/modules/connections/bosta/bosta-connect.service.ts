import { randomBytes, randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { trxQueryClient } from "@mizan/db";
import { MizanEngine, SqlStore } from "@mizan/engine";
import { auditActor, AuditService } from "../../../platform/audit/audit.service.js";
import type { AuthContext } from "../../../platform/auth/auth.types.js";
import { APP_CONFIG, type AppConfig } from "../../../platform/config.js";
import { Database } from "../../../platform/db/database.js";
import { ProblemError } from "../../../platform/http/problem.js";
import { SecretsService } from "../../../platform/secrets/secrets.service.js";
import { ENGINE_RUNTIME, EngineRegistry, type RuntimeFactory } from "../../../integrations/engine-registry.js";
import { STORE_PROVIDERS } from "../../../integrations/connection-resolver.js";
import { ConnectionLifecycle } from "../../../integrations/connection-lifecycle.js";
import { WebhookRouter } from "../../../integrations/webhook-router.js";
import { toConnectionView, type ConnectionView } from "../connections.dto.js";

const CONNECTION_COLUMNS = ["id", "kind", "provider", "external_account", "display_name", "status", "status_reason", "config", "updated_at"] as const;

/**
 * Connect Bosta with the merchant's API key (E4-5). The key is stored encrypted with a webhook token
 * Mizan generates; the connection starts `pending` and the engine checks the key in the background
 * (bosta.checkAccess, rule 3: no provider call in a request). CourierAccess then marks it `active`
 * or `needs_attention`. Saving a new key replaces the old one and checks again.
 */
@Injectable()
export class BostaConnectService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(SecretsService) private readonly secrets: SecretsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EngineRegistry) private readonly registry: EngineRegistry,
    @Inject(ENGINE_RUNTIME) private readonly runtime: RuntimeFactory,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(ConnectionLifecycle) private readonly lifecycle: ConnectionLifecycle,
    @Inject(WebhookRouter) private readonly router: WebhookRouter,
  ) {}

  async saveKey(auth: AuthContext, apiKey: string): Promise<ConnectionView> {
    const tenantId = auth.tenant!.id;
    const by = auditActor(auth);
    const view = await this.db.tenant(tenantId, async (trx) => {
      const shop = await trx.selectFrom("connections").select("id").where("provider", "in", [...STORE_PROVIDERS]).where("status", "!=", "disconnected").orderBy("created_at").executeTakeFirst();
      if (!shop) throw new ProblemError(409, "store_not_connected", "connect the store before the courier");
      const existing = await trx.selectFrom("connections").select(["id", "secret_ref"]).where("provider", "=", "bosta").forUpdate().executeTakeFirst();

      let id: string;
      if (existing?.secret_ref) {
        const old = JSON.parse((await this.secrets.read(trx, tenantId, existing.secret_ref)).reveal()) as { webhookToken?: string };
        await this.secrets.rotate(trx, tenantId, existing.secret_ref, JSON.stringify({ apiKey, webhookToken: old.webhookToken ?? token() }), by);
        id = existing.id;
        await trx.updateTable("connections").set({ status: "pending", status_reason: null, updated_at: new Date() }).where("id", "=", id).execute();
      } else {
        const ref = await this.secrets.create(trx, tenantId, JSON.stringify({ apiKey, webhookToken: token() }), by);
        if (existing) {
          id = existing.id;
          await trx.updateTable("connections").set({ secret_ref: ref, status: "pending", status_reason: null, updated_at: new Date() }).where("id", "=", id).execute();
        } else {
          id = (await trx.insertInto("connections").values({
            tenant_id: tenantId, kind: "courier", provider: "bosta", external_account: "bosta", display_name: "Bosta", secret_ref: ref, status: "pending",
          }).returning("id").executeTakeFirstOrThrow()).id;
        }
      }
      await this.audit.record(trx, { action: "connection.key_saved", tenantId, entity: { type: "connection", id }, after: { provider: "bosta", status: "pending" }, ...by });

      // Check the key in the background, queued in this transaction: no key saved without its check.
      const store = new SqlStore(trxQueryClient(trx), { tenantId, store: shop.id, connections: { bosta: id } });
      await store.enqueue(MizanEngine.bostaAccessCheckJob(randomUUID()), this.runtime(tenantId).clock.now()); // the engine's clock schedules its jobs

      const row = await trx.selectFrom("connections").select([...CONNECTION_COLUMNS]).where("id", "=", id).executeTakeFirstOrThrow();
      return toConnectionView(row);
    });
    this.registry.invalidate(tenantId); // the next engine reads the new key
    this.router.forget(view.id); // W3/W4: its next webhook routes from the saved row
    return view;
  }

  /** U7: the team's own name for a connection (audited). */
  async rename(auth: AuthContext, id: string, displayName: string | null): Promise<ConnectionView> {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const before = await trx.selectFrom("connections").select(["display_name"]).where("id", "=", id).forUpdate().executeTakeFirst();
      if (!before) throw new ProblemError(404, "not_found", "no connection with this id");
      const row = await trx.updateTable("connections").set({ display_name: displayName, updated_at: new Date() }).where("id", "=", id)
        .returning([...CONNECTION_COLUMNS]).executeTakeFirstOrThrow();
      await this.audit.record(trx, { action: "connection.renamed", tenantId, ...auditActor(auth), entity: { type: "connection", id }, before: { displayName: before.display_name }, after: { displayName } });
      return toConnectionView(row, this.config.SHOPIFY_SCOPES.split(","));
    });
  }

  /**
   * U7: the team stops using a store or courier. The owner types the store's address (or the
   * provider's name) to confirm; the lifecycle drops the credential and queued jobs, history stays.
   */
  async disconnect(auth: AuthContext, id: string, confirm: string, ip?: string): Promise<ConnectionView> {
    const tenantId = auth.tenant!.id;
    const c = await this.db.tenant(tenantId, (trx) => trx.selectFrom("connections").select(["provider", "external_account", "status"]).where("id", "=", id).executeTakeFirst());
    if (!c) throw new ProblemError(404, "not_found", "no connection with this id");
    if (c.status === "disconnected") throw new ProblemError(409, "already_disconnected", "this connection is already disconnected");
    const expected = (c.external_account ?? c.provider).trim().toLowerCase();
    if (confirm.trim().toLowerCase() !== expected) {
      throw new ProblemError(422, "validation_failed", "type the store's address to confirm", [{ path: "confirm", code: "does_not_match" }]);
    }
    await this.lifecycle.disconnectByTeam(tenantId, id, { actor: { type: "user", id: auth.user.id }, ...(ip ? { ip } : {}) });
    const row = await this.db.tenant(tenantId, (trx) => trx.selectFrom("connections").select([...CONNECTION_COLUMNS]).where("id", "=", id).executeTakeFirstOrThrow());
    return toConnectionView(row);
  }

  async list(tenantId: string): Promise<ConnectionView[]> {
    const rows = await this.db.tenant(tenantId, (trx) => trx.selectFrom("connections").select([...CONNECTION_COLUMNS]).orderBy("created_at").execute());
    const required = this.config.SHOPIFY_SCOPES.split(",");
    return rows.map((r) => toConnectionView(r, required));
  }
}

/** Bosta signs its webhooks with this; the merchant pastes it in Bosta's dashboard (later step). */
const token = () => randomBytes(24).toString("hex");

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
import { toConnectionView, type ConnectionView } from "../connections.dto.js";

const CONNECTION_COLUMNS = ["id", "kind", "provider", "external_account", "status", "status_reason", "config", "updated_at"] as const;

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
    return view;
  }

  async list(tenantId: string): Promise<ConnectionView[]> {
    const rows = await this.db.tenant(tenantId, (trx) => trx.selectFrom("connections").select([...CONNECTION_COLUMNS]).orderBy("created_at").execute());
    const required = this.config.SHOPIFY_SCOPES.split(",");
    return rows.map((r) => toConnectionView(r, required));
  }
}

/** Bosta signs its webhooks with this; the merchant pastes it in Bosta's dashboard (later step). */
const token = () => randomBytes(24).toString("hex");

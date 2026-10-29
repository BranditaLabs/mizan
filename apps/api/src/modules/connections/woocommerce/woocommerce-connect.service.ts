import { randomBytes, randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { asWorker, trxQueryClient } from "@mizan/db";
import { MizanEngine, SqlStore } from "@mizan/engine";
import { auditActor, AuditService } from "../../../platform/audit/audit.service.js";
import type { AuthContext } from "../../../platform/auth/auth.types.js";
import { Database } from "../../../platform/db/database.js";
import { ProblemError } from "../../../platform/http/problem.js";
import { SecretsService } from "../../../platform/secrets/secrets.service.js";
import { ENGINE_RUNTIME, EngineRegistry, type RuntimeFactory } from "../../../integrations/engine-registry.js";
import { WebhookRouter } from "../../../integrations/webhook-router.js";
import { toConnectionView, type ConnectionView } from "../connections.dto.js";

const CONNECTION_COLUMNS = ["id", "kind", "provider", "external_account", "status", "status_reason", "config", "updated_at"] as const;
/** History imported on connect, as for Shopify (E3-5). */
export const WOO_BACKFILL_DAYS = 60;

/**
 * Connect a WooCommerce store (E5-7) with read/write REST keys the owner creates in WooCommerce
 * (Settings → Advanced → REST API). The keys are stored encrypted with a webhook secret Mizan
 * generates; the connection starts `pending`. In the same transaction (rule 3: no provider call
 * in a request) the engine is asked to point the store's webhooks at Mizan — which is also the
 * keys' check: `active` when it works, `needs_attention` (key_refused / key_lacks_permission) when
 * not — and to import the last 60 days of orders, a page per job.
 */
@Injectable()
export class WooCommerceConnectService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(SecretsService) private readonly secrets: SecretsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EngineRegistry) private readonly registry: EngineRegistry,
    @Inject(WebhookRouter) private readonly router: WebhookRouter,
    @Inject(ENGINE_RUNTIME) private readonly runtime: RuntimeFactory,
  ) {}

  async connect(auth: AuthContext, body: { siteUrl: string; consumerKey: string; consumerSecret: string }): Promise<ConnectionView> {
    const tenantId = auth.tenant!.id;
    const by = auditActor(auth);
    const site = normalizeSite(body.siteUrl);
    const account = `${site.host}${site.pathname === "/" ? "" : site.pathname}`;
    const siteUrl = `${site.origin}${site.pathname === "/" ? "" : site.pathname}`;
    const elsewhere = await asWorker(this.db.kysely, (trx) => trx.selectFrom("connections").select("tenant_id")
      .where("provider", "=", "woocommerce").where("external_account", "=", account).where("tenant_id", "!=", tenantId).where("status", "!=", "disconnected").executeTakeFirst());
    if (elsewhere) throw new ProblemError(409, "store_connected_elsewhere", "this WooCommerce store is connected to another Mizan account");

    const view = await this.db.tenant(tenantId, async (trx) => {
      const existing = await trx.selectFrom("connections").select(["id", "secret_ref"]).where("provider", "=", "woocommerce").where("external_account", "=", account).forUpdate().executeTakeFirst();
      const config = JSON.stringify({ siteUrl });
      let id: string;
      let reconnected = false;
      if (existing?.secret_ref) {
        // New keys for the same store: the webhook secret stays, so webhooks already signed with it keep working.
        const old = JSON.parse((await this.secrets.read(trx, tenantId, existing.secret_ref)).reveal()) as { webhookSecret?: string };
        await this.secrets.rotate(trx, tenantId, existing.secret_ref, JSON.stringify({ consumerKey: body.consumerKey, consumerSecret: body.consumerSecret, webhookSecret: old.webhookSecret ?? secret() }), by);
        id = existing.id;
        reconnected = true;
        await trx.updateTable("connections").set({ status: "pending", status_reason: null, config, updated_at: new Date() }).where("id", "=", id).execute();
      } else {
        const ref = await this.secrets.create(trx, tenantId, JSON.stringify({ consumerKey: body.consumerKey, consumerSecret: body.consumerSecret, webhookSecret: secret() }), by);
        id = (await trx.insertInto("connections").values({
          tenant_id: tenantId, kind: "store", provider: "woocommerce", external_account: account, display_name: site.host, secret_ref: ref, config, status: "pending",
        }).returning("id").executeTakeFirstOrThrow()).id;
      }
      await this.audit.record(trx, { action: "connection.key_saved", tenantId, entity: { type: "connection", id }, after: { provider: "woocommerce", account, status: "pending", reconnected }, ...by });

      // Queued in this transaction: no keys saved without their check and the history import.
      const store = new SqlStore(trxQueryClient(trx), { tenantId, store: id, connections: { woocommerce: id } });
      const now = this.runtime(tenantId).clock.now(); // the engine's clock schedules its jobs
      const runKey = randomUUID();
      await store.enqueue(MizanEngine.wooWebhooksJob(runKey), now);
      if (!reconnected) await store.enqueue(MizanEngine.wooBackfillJob(runKey, now - WOO_BACKFILL_DAYS * 86_400_000), now);

      const row = await trx.selectFrom("connections").select([...CONNECTION_COLUMNS]).where("id", "=", id).executeTakeFirstOrThrow();
      return toConnectionView(row);
    });
    this.registry.invalidate(tenantId); // the next engine reads the new keys
    this.router.forget(view.id);
    return view;
  }
}

/** "shop.example.com", "https://shop.example.com/" → URL; HTTPS only (the keys travel as Basic auth). */
export function normalizeSite(input: string): URL {
  const raw = /^[a-z][a-z0-9+.-]*:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`;
  let url: URL;
  try { url = new URL(raw); } catch { throw new ProblemError(422, "invalid_site", "enter the store's address, like https://shop.example.com"); }
  if (url.protocol !== "https:") throw new ProblemError(422, "site_not_https", "the store must be on HTTPS: WooCommerce keys are sent with every request");
  url.pathname = url.pathname.replace(/\/(wp-admin|wp-json).*$/i, "/").replace(/\/+$/, "") || "/";
  url.search = "";
  url.hash = "";
  return url;
}

/** The secret WooCommerce signs this store's webhooks with (set by Mizan on the webhooks it creates). */
const secret = () => randomBytes(24).toString("hex");

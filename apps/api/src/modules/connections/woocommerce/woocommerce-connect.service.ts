import { randomBytes, randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { asWorker, trxQueryClient } from "@mizan/db";
import { MizanEngine, SqlStore } from "@mizan/engine";
import { auditActor, AuditService } from "../../../platform/audit/audit.service.js";
import { APP_CONFIG, type AppConfig } from "../../../platform/config.js";
import { readWooAuthToken, WOO_AUTH_TTL_MS, wooAuthToken } from "./woocommerce-auth.js";
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
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async connect(auth: AuthContext, body: { siteUrl: string; consumerKey: string; consumerSecret: string }): Promise<ConnectionView> {
    return this.save(auth.tenant!.id, auditActor(auth), body);
  }

  /**
   * One click (E5-7): the address of WooCommerce's approval page for this store. The owner signs
   * in to WordPress there and approves Read/Write access; WooCommerce then posts the new keys to
   * `/webhooks/woocommerce-auth` (with the signed `user_id`) and sends the browser back to
   * Settings → Integrations with `success=1` or `0`.
   */
  authorizeUrl(auth: AuthContext, siteUrl: string, locale: "ar" | "en"): { url: string; expiresAt: string } {
    const site = normalizeSite(siteUrl);
    const base = `${site.origin}${site.pathname === "/" ? "" : site.pathname}`;
    const expiresAt = Date.now() + WOO_AUTH_TTL_MS;
    const token = wooAuthToken(this.config.LINK_SIGNING_KEY, { tenantId: auth.tenant!.id, userId: auth.user.id, siteUrl: base, expiresAt });
    const q = new URLSearchParams({
      app_name: "Mizan", scope: "read_write", user_id: token,
      return_url: new URL(`/${locale}/settings/integrations?woo=returned`, this.config.WEB_URL).toString(),
      callback_url: new URL("/webhooks/woocommerce-auth", this.config.PUBLIC_URL).toString(),
    });
    return { url: `${base}/wc-auth/v1/authorize?${q.toString()}`, expiresAt: new Date(expiresAt).toISOString() };
  }

  /**
   * WooCommerce's post with the keys the owner approved. Answers 200 only when they are saved
   * (WooCommerce tells the owner it failed otherwise). The member must still be an owner or admin
   * of the store, the access Read/Write, and the token signed by Mizan and not expired.
   */
  async receiveKeys(raw: string): Promise<{ status: number; body: Record<string, unknown> }> {
    let p: { user_id?: unknown; consumer_key?: unknown; consumer_secret?: unknown; key_permissions?: unknown };
    try { p = JSON.parse(raw); } catch { return { status: 400, body: { error: "invalid json" } }; }
    const claim = readWooAuthToken(this.config.LINK_SIGNING_KEY, p.user_id);
    if (!claim) return { status: 401, body: { error: "unknown or expired request" } };
    if (p.key_permissions !== "read_write") return { status: 400, body: { error: "Mizan needs Read/Write access" } };
    if (typeof p.consumer_key !== "string" || !/^ck_[A-Za-z0-9_]{8,}$/.test(p.consumer_key) || typeof p.consumer_secret !== "string" || !/^cs_[A-Za-z0-9_]{8,}$/.test(p.consumer_secret)) {
      return { status: 400, body: { error: "malformed keys" } };
    }
    const member = await this.db.tenant(claim.tenantId, (trx) => trx.selectFrom("memberships").select("role")
      .where("user_id", "=", claim.userId).where("status", "=", "active").executeTakeFirst());
    if (!member || !["owner", "admin"].includes(member.role)) return { status: 403, body: { error: "the member who asked can no longer connect stores" } };
    try {
      await this.save(claim.tenantId, { actor: { type: "user" as const, id: claim.userId } }, { siteUrl: claim.siteUrl, consumerKey: p.consumer_key, consumerSecret: p.consumer_secret });
    } catch (e) {
      if (e instanceof ProblemError) return { status: e.status, body: { error: e.code } };
      throw e;
    }
    return { status: 200, body: { saved: true } };
  }

  private async save(tenantId: string, by: { actor: { type: "user"; id: string }; ip?: string | undefined }, body: { siteUrl: string; consumerKey: string; consumerSecret: string }): Promise<ConnectionView> {
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

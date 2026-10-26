import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { sql } from "kysely";
import { exchangeShopifyCode, isIntegrationError, missingScopes, normalizeShop, shopifyAuthorizeUrl, verifyShopifyQuery } from "@mizan/engine";
import { AuditService, auditActor } from "../../../platform/audit/audit.service.js";
import type { AuthContext } from "../../../platform/auth/auth.types.js";
import { APP_CONFIG, type AppConfig } from "../../../platform/config.js";
import { Database } from "../../../platform/db/database.js";
import { EventsService } from "../../../platform/events/events.service.js";
import { ProblemError } from "../../../platform/http/problem.js";
import { SecretsService } from "../../../platform/secrets/secrets.service.js";
import { ENGINE_RUNTIME, EngineRegistry, type RuntimeFactory } from "../../../integrations/engine-registry.js";
import { WebhookRouter } from "../../../integrations/webhook-router.js";
import { signState, verifyState } from "./oauth-state.js";

/** A pending install can be claimed for an hour: long enough to sign up, short enough to be useless if leaked. */
export const INSTALL_TTL_MS = 60 * 60_000;

/** Reasons the callback sends the browser back with `?error=` (shown by the web app in AR/EN). */
export type InstallError =
  | "shopify_not_configured" | "invalid_signature" | "invalid_shop" | "invalid_state"
  | "install_cancelled" | "shopify_unavailable" | "install_failed" | "scopes_missing";

export interface ClaimResult {
  connection: { id: string; provider: "shopify"; account: string; status: "active"; scopes: string[] };
  reconnected: boolean;
}

const sha256 = (v: string) => createHash("sha256").update(v).digest();
const label = (installId: string) => `shopify-install:${installId}`;

/**
 * Shopify OAuth install (E3-1), in three steps:
 *
 * 1. `begin` (signed-in owner/admin) or `entry` (App Store launch, before any Mizan sign-in):
 *    a signed state bound to the shop — and, from inside Mizan, to the user and store — then
 *    Shopify's authorize page.
 * 2. `callback` (public): verify Shopify's signature and our state, exchange the code for the
 *    offline token, keep it sealed as a pending install, send the browser to the web app with
 *    a one-time claim token.
 * 3. `claim` (signed-in owner/admin): attach the install to the caller's store as a connection.
 *
 * Splitting exchange and claim satisfies Shopify's "authenticate immediately after install" and
 * still ties every connection to a signed-in Mizan user: a state started by someone else's
 * account cannot be claimed by you, and yours cannot be claimed by them (login CSRF).
 */
@Injectable()
export class ShopifyInstallService {
  private readonly log = new Logger("ShopifyInstall");

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(Database) private readonly db: Database,
    @Inject(SecretsService) private readonly secrets: SecretsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(EngineRegistry) private readonly registry: EngineRegistry,
    @Inject(WebhookRouter) private readonly router: WebhookRouter,
    @Inject(ENGINE_RUNTIME) private readonly runtime: RuntimeFactory,
  ) {}

  /** Start from inside Mizan: the install is bound to this user and store. */
  begin(auth: AuthContext, shopInput: unknown): { authorizeUrl: string } {
    const app = this.app();
    if (!app) throw new ProblemError(503, "shopify_not_configured", "the Shopify app credentials are not set on this server");
    const shop = normalizeShop(shopInput);
    if (!shop) throw new ProblemError(422, "invalid_shop", "shop must look like your-store.myshopify.com");
    const state = signState(app.clientSecret, { shop, tenant: auth.tenant!.id, user: auth.user.id }, Date.now());
    return { authorizeUrl: this.authorizeUrl(app, shop, state) };
  }

  /** App Store install / app launch from Shopify admin: straight to OAuth (unbound install). */
  entry(query: Record<string, unknown>): string {
    const app = this.app();
    if (!app) return this.webError("shopify_not_configured");
    if (!verifyShopifyQuery(query, app.clientSecret, Date.now())) return this.webError("invalid_signature");
    const shop = normalizeShop(query.shop);
    if (!shop) return this.webError("invalid_shop");
    return this.authorizeUrl(app, shop, signState(app.clientSecret, { shop }, Date.now()));
  }

  /** Shopify redirects here after the merchant approves. Returns where to send the browser. */
  async callback(query: Record<string, unknown>): Promise<string> {
    const app = this.app();
    if (!app) return this.webError("shopify_not_configured");
    if (!verifyShopifyQuery(query, app.clientSecret, Date.now())) return this.webError("invalid_signature");
    const shop = normalizeShop(query.shop);
    if (!shop) return this.webError("invalid_shop");
    const state = verifyState(app.clientSecret, query.state, Date.now());
    if (!state || state.shop !== shop) return this.webError("invalid_state");
    if (typeof query.code !== "string" || !query.code) return this.webError("install_cancelled");

    let grant;
    try {
      grant = await exchangeShopifyCode(this.runtime(state.tenant ?? "-"), { shop, clientId: app.clientId, clientSecret: app.clientSecret, code: query.code });
    } catch (err) {
      const kind = isIntegrationError(err) ? err.kind : "unknown";
      this.log.warn({ shop, kind }, "Shopify code exchange failed");
      return this.webError(["transient", "timeout", "rate_limited"].includes(kind) ? "shopify_unavailable" : "install_failed");
    }
    const missing = missingScopes(app.scopes, grant.scopes);
    if (missing.length) {
      this.log.warn({ shop, missing }, "Shopify granted fewer scopes than required");
      return this.webError("scopes_missing");
    }

    const id = randomUUID();
    const claim = randomBytes(32).toString("base64url");
    const sealed = await this.secrets.sealDetached(label(id), grant.accessToken);
    await this.db.worker((trx) => trx.insertInto("shopify_installs").values({
      id, shop, scopes: grant.scopes.join(","), ...sealed, claim_hash: sha256(claim),
      bound_tenant: state.tenant ?? null, bound_user: state.user ?? null, expires_at: new Date(Date.now() + INSTALL_TTL_MS),
    }).execute());
    return this.webUrl({ install: claim, shop });
  }

  /** Attach a pending install to the caller's store. */
  async claim(auth: AuthContext, claimToken: string): Promise<ClaimResult> {
    const tenantId = auth.tenant!.id;
    const install = await this.db.worker((trx) => trx.selectFrom("shopify_installs").selectAll()
      .where("claim_hash", "=", sha256(claimToken)).executeTakeFirst());
    if (!install || install.claimed_at) throw new ProblemError(404, "install_not_found", "install the app from Shopify again");
    if (install.expires_at.getTime() < Date.now()) throw new ProblemError(410, "install_expired", "install the app from Shopify again");
    if (install.bound_tenant && (install.bound_tenant !== tenantId || install.bound_user !== auth.user.id)) {
      throw new ProblemError(403, "install_not_yours", "this install was started by another account; start it again from your store");
    }
    const elsewhere = await this.db.worker((trx) => trx.selectFrom("connections").select("tenant_id")
      .where("provider", "=", "shopify").where("external_account", "=", install.shop)
      .where("status", "!=", "disconnected").where("tenant_id", "!=", tenantId).executeTakeFirst());
    if (elsewhere) throw new ProblemError(409, "shop_connected_elsewhere", "disconnect it there first, or contact support");
    await this.db.tenant(tenantId, (trx) => this.otherStore(trx, install.shop));

    // Reserve before writing: of two concurrent claims, one wins.
    const reserved = await this.db.worker((trx) => trx.updateTable("shopify_installs").set({ claimed_at: sql`now()` })
      .where("id", "=", install.id).where("claimed_at", "is", null).returning("id").executeTakeFirst());
    if (!reserved) throw new ProblemError(404, "install_not_found", "install the app from Shopify again");

    const token = await this.secrets.openDetached(label(install.id), install);
    const scopes = install.scopes.split(",").filter(Boolean);
    const credential = JSON.stringify({ accessToken: token.reveal() });
    const by = auditActor(auth);
    const result = await this.db.tenant(tenantId, async (trx) => {
      await this.otherStore(trx, install.shop);
      const existing = await trx.selectFrom("connections").select(["id", "secret_ref", "config"])
        .where("provider", "=", "shopify").where("external_account", "=", install.shop).orderBy("created_at", "desc").executeTakeFirst();
      let id: string;
      if (existing) {
        const ref = existing.secret_ref ?? await this.secrets.create(trx, tenantId, credential, by);
        if (existing.secret_ref) await this.secrets.rotate(trx, tenantId, ref, credential, by);
        const config = { ...(typeof existing.config === "object" && existing.config && !Array.isArray(existing.config) ? existing.config : {}), scopes };
        await trx.updateTable("connections").set({ status: "active", status_reason: null, secret_ref: ref, config: JSON.stringify(config), updated_at: new Date() })
          .where("id", "=", existing.id).execute();
        id = existing.id;
      } else {
        const ref = await this.secrets.create(trx, tenantId, credential, by);
        id = (await trx.insertInto("connections").values({
          tenant_id: tenantId, kind: "store", provider: "shopify", external_account: install.shop, display_name: install.shop,
          secret_ref: ref, config: JSON.stringify({ scopes }),
        }).returning("id").executeTakeFirstOrThrow()).id;
      }
      const reconnected = Boolean(existing);
      await this.audit.record(trx, { action: "connection.connected", tenantId, entity: { type: "connection", id }, after: { provider: "shopify", shop: install.shop, scopes, reconnected }, ...by });
      await this.events.emit(trx, { type: "connection.connected", tenantId, entity: { type: "connection", id }, data: { provider: "shopify", kind: "store", reconnected }, actor: { type: "user", id: auth.user.id } });
      return { id, reconnected };
    });

    this.registry.invalidate(tenantId);
    this.router.forget(result.id);
    return { connection: { id: result.id, provider: "shopify", account: install.shop, status: "active", scopes }, reconnected: result.reconnected };
  }

  /** Several Shopify stores per account (E2-7), up to MAX_SHOPIFY_STORES; reconnecting one already counted is always fine. */
  private async otherStore(trx: Parameters<Parameters<Database["tenant"]>[1]>[0], shop: string): Promise<void> {
    const others = await trx.selectFrom("connections").select("id").where("provider", "=", "shopify")
      .where("status", "!=", "disconnected").where("external_account", "!=", shop).execute();
    if (others.length >= this.config.MAX_SHOPIFY_STORES) {
      throw new ProblemError(409, "store_limit_reached", `up to ${this.config.MAX_SHOPIFY_STORES} Shopify stores per account; disconnect one first`);
    }
  }

  private app() {
    const { SHOPIFY_API_KEY: clientId, SHOPIFY_API_SECRET: clientSecret } = this.config;
    return clientId && clientSecret ? { clientId, clientSecret, scopes: this.config.SHOPIFY_SCOPES.split(",") } : null;
  }

  private authorizeUrl(app: { clientId: string; scopes: string[] }, shop: string, state: string): string {
    return shopifyAuthorizeUrl({ shop, clientId: app.clientId, scopes: app.scopes, state, redirectUri: new URL("/v1/connections/shopify/callback", this.config.PUBLIC_URL).toString() });
  }

  private webUrl(params: Record<string, string>): string {
    const url = new URL("/integrations/shopify/connect", this.config.WEB_URL);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return url.toString();
  }

  private webError(code: InstallError): string {
    return this.webUrl({ error: code });
  }
}

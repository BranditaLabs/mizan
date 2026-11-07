import { Controller, Get, HttpCode, Inject, Logger, Param, Post, Query, Req, Res } from "@nestjs/common";
import type { IntakeOutcome, WebhookResult } from "@mizan/engine";
import { ApiExcludeController } from "@nestjs/swagger";
import type { HttpReply as Response, HttpRequest as Request } from "../platform/http/http.types.js";
import { Public } from "../platform/auth/decorators.js";
import { PrivacyService } from "../modules/privacy/privacy.service.js";
import { WhatsAppChat } from "../modules/confirmation/whatsapp-chat.service.js";
import { ConnectionLifecycle } from "./connection-lifecycle.js";
import { EngineRegistry } from "./engine-registry.js";
import { WebhookRouter } from "./webhook-router.js";

const headersOf = (req: Request) =>
  Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));

const rawBody = (req: Request): string => (Buffer.isBuffer(req.body) ? req.body.toString("utf8") : typeof req.body === "string" ? req.body : "");

/** Outcomes worth a log line until the Event Center records every hit (A-10a): what was not taken in. */
/** An engine built this recently already holds the connection's current credentials (freshOnReject). */
const REFRESH_ON_REJECT_MS = 5_000;

const NOT_TAKEN = new Set<IntakeOutcome>(["unknown_connection", "unrouted", "disconnected", "unparseable", "no_resource_id"]);

/**
 * Provider webhooks: thin and fast (CLAUDE.md rule 6). Route by connection,
 * verify (HMAC / token), dedupe, enqueue, answer — the work runs as outbox jobs.
 * Unknown connection → 404; disconnected → 200 so the provider stops retrying.
 * Every answer carries an outcome (FX-3a); the ones that took nothing in are logged with the
 * connection and provider only (no body, no personal data).
 */
@ApiExcludeController()
@Public()
@Controller("webhooks")
export class WebhooksController {
  private readonly log = new Logger("Webhooks");

  constructor(
    @Inject(WebhookRouter) private readonly router: WebhookRouter,
    @Inject(EngineRegistry) private readonly registry: EngineRegistry,
    @Inject(PrivacyService) private readonly privacy: PrivacyService,
    @Inject(ConnectionLifecycle) private readonly lifecycle: ConnectionLifecycle,
    @Inject(WhatsAppChat) private readonly whatsapp: WhatsAppChat,
  ) {}

  /**
   * WhatsApp Cloud API (E6-10): one URL for every connected number (Meta app → WhatsApp →
   * Configuration). GET answers Meta's subscription check with the verify token; POST carries
   * messages and delivery statuses, signed with the app secret, routed by the number's id.
   */
  @Get("whatsapp")
  whatsappVerify(@Query() query: Record<string, string>, @Res() res: Response) {
    return res.code(200).type("text/plain").send(this.whatsapp.challenge(query));
  }

  @Post("whatsapp")
  @HttpCode(200)
  async whatsappEvents(@Req() req: Request, @Res() res: Response) {
    const result = await this.whatsapp.receive(headersOf(req)["x-hub-signature-256"], rawBody(req));
    return res.code(result.status).send(result.body);
  }

  /** Shopify compliance webhooks (one URL for the app, set in its configuration). Declared before the per-connection route. */
  @Post("shopify/gdpr")
  @HttpCode(200)
  async shopifyCompliance(@Req() req: Request, @Res() res: Response) {
    const result = await this.privacy.receiveShopify(headersOf(req), rawBody(req));
    return res.code(result.status).send(result.body);
  }

  /** Answer a webhook, logging what was not taken in (the intake row's outcome, until A-10a stores it). */
  private answer(res: Response, provider: string, connectionId: string, result: WebhookResult, tenantId?: string) {
    if (result.outcome && NOT_TAKEN.has(result.outcome)) {
      const signal = result.outcome === "unrouted" || result.outcome === "unknown_connection" ? { signal: "unknown_connection" } : {};
      this.log.warn({ provider, connectionId, ...(tenantId ? { tenantId } : {}), outcome: result.outcome, ...signal }, "webhook not taken in");
    }
    return res.code(result.status).send(result.body);
  }

  /** Route a per-connection webhook: unknown → 404, disconnected → 200 ignored (neither cached, W3/W4). */
  private async routeFor(connectionId: string, provider: string): Promise<{ tenantId: string } | WebhookResult> {
    const route = await this.router.route(connectionId);
    if (!route || route.provider !== provider) return { status: 404, body: { error: "unknown connection" }, outcome: "unknown_connection" };
    if (route.status === "disconnected") return { status: 200, body: { ignored: "disconnected" }, outcome: "disconnected" };
    return { tenantId: route.tenantId };
  }

  @Post("shopify/:connectionId")
  @HttpCode(200)
  async shopify(@Param("connectionId") connectionId: string, @Req() req: Request, @Res() res: Response) {
    const route = await this.routeFor(connectionId, "shopify");
    if (!("tenantId" in route)) return this.answer(res, "shopify", connectionId, route);
    const headers = headersOf(req);
    const result = await this.freshOnReject(route.tenantId, async () => (await this.registry.get(route.tenantId, connectionId)).engine.handleShopifyWebhook(headers, rawBody(req)));
    // Verified: an uninstall ends the connection now (E3-4). A redelivery too (FX-3a): the dedupe mark is
    // saved before this runs, so if it failed (Shopify got a 5xx) the retry is a "duplicate" that must still
    // disconnect. providerRevoked does nothing for a connection already disconnected.
    if (result.status === 200 && (result.outcome === "accepted" || result.outcome === "duplicate") && (headers["x-shopify-topic"] ?? "").toLowerCase() === "app/uninstalled") {
      await this.lifecycle.providerRevoked(route.tenantId, connectionId, "app_uninstalled");
    }
    return this.answer(res, "shopify", connectionId, result, route.tenantId);
  }

  /** E5-7: a WooCommerce store's webhooks (signed with the secret Mizan set on them); the save-time ping is answered 200. */
  @Post("woocommerce/:connectionId")
  @HttpCode(200)
  async woocommerce(@Param("connectionId") connectionId: string, @Req() req: Request, @Res() res: Response) {
    const route = await this.routeFor(connectionId, "woocommerce");
    if (!("tenantId" in route)) return this.answer(res, "woocommerce", connectionId, route);
    const result = await this.freshOnReject(route.tenantId, async () => (await this.registry.get(route.tenantId, connectionId)).engine.handleWooCommerceWebhook(headersOf(req), rawBody(req)));
    return this.answer(res, "woocommerce", connectionId, result, route.tenantId);
  }

  @Post("bosta/:connectionId")
  @HttpCode(200)
  async bosta(@Param("connectionId") connectionId: string, @Query() query: Record<string, string>, @Req() req: Request, @Res() res: Response) {
    const route = await this.routeFor(connectionId, "bosta");
    if (!("tenantId" in route)) return this.answer(res, "bosta", connectionId, route);
    const tenantId = route.tenantId;
    const result = await this.freshOnReject(tenantId, () => this.routeBosta(tenantId, query, headersOf(req), rawBody(req)));
    return this.answer(res, "bosta", connectionId, result, tenantId);
  }

  /**
   * FX-3a: an engine cached in this process may hold a credential another process replaced (a
   * reconnect mints a new Bosta webhook token; only the process that connected forgets its engines).
   * A rejected signature from an engine built more than a few seconds ago is checked once more on
   * an engine built now, so a reconnected store's webhooks are never refused for the cache's lifetime.
   * Throttled per tenant: a run of forged webhooks rebuilds at most once per REFRESH_ON_REJECT_MS.
   */
  private async freshOnReject(tenantId: string, handle: () => Promise<WebhookResult>): Promise<WebhookResult> {
    const result = await handle();
    if (result.outcome !== "rejected_signature" || !this.registry.invalidateIfOlder(tenantId, REFRESH_ON_REJECT_MS)) return result;
    return handle();
  }

  /**
   * One Bosta account serves all of a tenant's stores (E2-7): the store that booked the shipment
   * takes its updates. With one store, that store (its engine re-reads the delivery and tells an
   * orphan apart). With several, a verified webhook for a shipment no store has is unrouted
   * (W9): never handed to the first store; the poll of active shipments picks it up once booked.
   */
  private async routeBosta(tenantId: string, query: Record<string, string>, headers: Record<string, string | undefined>, body: string): Promise<WebhookResult> {
    const engines = await this.registry.forTenant(tenantId);
    if (!engines.length) return { status: 200, body: { ignored: "no store connected" }, outcome: "unrouted" };
    let owner = engines.length === 1 ? engines[0] : undefined;
    if (!owner) {
      const tracking = engines[0]!.engine.peekBostaWebhook(query, headers, body);
      // A wrong token or an unreadable body, or no tracking number: any engine answers it (401, drift, a nudge).
      if (tracking === null) owner = engines[0];
      else for (const e of engines) if (await e.store.get("shipment", tracking)) { owner = e; break; }
    }
    if (!owner) return { status: 200, body: { ignored: "no store has this shipment" }, outcome: "unrouted" };
    const result = await owner.engine.handleBostaWebhook(query, headers, body);
    // W6 with several stores: an update naming no shipment may be any store's, so every store polls its active shipments.
    if (result.outcome === "no_resource_id" && engines.length > 1) for (const e of engines.slice(1)) await e.engine.nudgeBostaPoll();
    return result;
  }
}

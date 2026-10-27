import { Controller, Get, HttpCode, Inject, Param, Post, Query, Req, Res } from "@nestjs/common";
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

/**
 * Provider webhooks: thin and fast (CLAUDE.md rule 6). Route by connection,
 * verify (HMAC / token), dedupe, enqueue, answer — the work runs as outbox jobs.
 * Unknown connection → 404; disconnected → 200 so the provider stops retrying.
 */
@ApiExcludeController()
@Public()
@Controller("webhooks")
export class WebhooksController {
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

  @Post("shopify/:connectionId")
  @HttpCode(200)
  async shopify(@Param("connectionId") connectionId: string, @Req() req: Request, @Res() res: Response) {
    const route = await this.router.route(connectionId);
    if (!route || route.provider !== "shopify") return res.code(404).send({ error: "unknown connection" });
    if (route.status === "disconnected") return res.code(200).send({ ignored: "disconnected" });
    const { engine } = await this.registry.get(route.tenantId, connectionId);
    const headers = headersOf(req);
    const result = await engine.handleShopifyWebhook(headers, rawBody(req));
    // Verified and new (not a redelivery): an uninstall ends the connection now (E3-4).
    if (result.status === 200 && result.body.accepted && (headers["x-shopify-topic"] ?? "").toLowerCase() === "app/uninstalled") {
      await this.lifecycle.providerRevoked(route.tenantId, connectionId, "app_uninstalled");
    }
    return res.code(result.status).send(result.body);
  }

  @Post("bosta/:connectionId")
  @HttpCode(200)
  async bosta(@Param("connectionId") connectionId: string, @Query() query: Record<string, string>, @Req() req: Request, @Res() res: Response) {
    const route = await this.router.route(connectionId);
    if (!route || route.provider !== "bosta") return res.code(404).send({ error: "unknown connection" });
    if (route.status === "disconnected") return res.code(200).send({ ignored: "disconnected" });
    // One Bosta account serves all of a tenant's stores (E2-7): the store that booked the
    // shipment takes its updates; a shipment no store knows goes to the first (orphan check).
    const engines = await this.registry.forTenant(route.tenantId);
    const headers = headersOf(req);
    const body = rawBody(req);
    let owner = engines[0];
    const tracking = engines.length > 1 ? engines[0]!.engine.peekBostaWebhook(query, headers, body) : null;
    if (tracking) {
      for (const e of engines) if (await e.store.get("shipment", tracking)) { owner = e; break; }
    }
    if (!owner) return res.code(200).send({ ignored: "no store connected" });
    const result = await owner.engine.handleBostaWebhook(query, headers, body);
    return res.code(result.status).send(result.body);
  }
}

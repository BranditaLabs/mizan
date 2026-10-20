import { Controller, HttpCode, Inject, Param, Post, Query, Req, Res } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { Public } from "../platform/auth/decorators.js";
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
  ) {}

  @Post("shopify/:connectionId")
  @HttpCode(200)
  async shopify(@Param("connectionId") connectionId: string, @Req() req: Request, @Res() res: Response) {
    const route = await this.router.route(connectionId);
    if (!route || route.provider !== "shopify") return res.status(404).json({ error: "unknown connection" });
    if (route.status === "disconnected") return res.status(200).json({ ignored: "disconnected" });
    const { engine } = await this.registry.get(route.tenantId);
    const result = await engine.handleShopifyWebhook(headersOf(req), rawBody(req));
    return res.status(result.status).json(result.body);
  }

  @Post("bosta/:connectionId")
  @HttpCode(200)
  async bosta(@Param("connectionId") connectionId: string, @Query() query: Record<string, string>, @Req() req: Request, @Res() res: Response) {
    const route = await this.router.route(connectionId);
    if (!route || route.provider !== "bosta") return res.status(404).json({ error: "unknown connection" });
    if (route.status === "disconnected") return res.status(200).json({ ignored: "disconnected" });
    const { engine } = await this.registry.get(route.tenantId);
    const result = await engine.handleBostaWebhook(query, headersOf(req), rawBody(req));
    return res.status(result.status).json(result.body);
  }
}

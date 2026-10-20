import { Controller, Get, Headers, Inject, Res } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { timingSafeEqual } from "node:crypto";
import type { Response } from "express";
import { Public } from "../auth/decorators.js";
import { APP_CONFIG, type AppConfig } from "../config.js";
import { MetricsService } from "./metrics.service.js";

/** 404 when no token is configured, 401 on a wrong token, else null (allowed). Constant-time compare. */
export function scrapeDenied(token: string | undefined, authorization: string | undefined): 401 | 404 | null {
  if (!token) return 404;
  const got = (authorization ?? "").replace(/^Bearer\s+/i, "");
  return got.length === token.length && timingSafeEqual(Buffer.from(got), Buffer.from(token)) ? null : 401;
}

/** GET /metrics — Prometheus scrape, behind METRICS_TOKEN; 404 when no token is configured. */
@ApiExcludeController()
@Public()
@Controller("metrics")
export class MetricsController {
  constructor(
    @Inject(MetricsService) private readonly metrics: MetricsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get()
  async scrape(@Headers("authorization") authorization: string | undefined, @Res() res: Response) {
    const denied = scrapeDenied(this.config.METRICS_TOKEN, authorization);
    if (denied) return res.status(denied).end();
    res.setHeader("Content-Type", this.metrics.registry.contentType);
    return res.send(await this.metrics.registry.metrics());
  }
}

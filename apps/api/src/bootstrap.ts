import { RequestMethod, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Logger } from "nestjs-pino";
import { AppModule, type AppOptions } from "./app.module.js";
import type { AppConfig } from "./platform/config.js";
import { mountOpenApi } from "./platform/openapi.js";
import { hardenHttp } from "./platform/http/hardening.js";
import { httpMetrics } from "./platform/metrics/metrics.middleware.js";
import { MetricsService } from "./platform/metrics/metrics.service.js";

/** Create and configure the HTTP app (no listen), shared by main.ts and tests. */
export async function createApp(config: AppConfig, options: AppOptions = {}): Promise<INestApplication> {
  // rawBody: webhook signatures are computed over the exact bytes received (H-5).
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config, options), { bufferLogs: true, rawBody: true, bodyParser: false });
  app.use(httpMetrics(app.get(MetricsService)));
  hardenHttp(app, config);
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix("v1", { exclude: [{ path: "health", method: RequestMethod.GET }, { path: "health/ready", method: RequestMethod.GET }, { path: "webhooks/*path", method: RequestMethod.POST }, { path: "metrics", method: RequestMethod.GET }] });
  mountOpenApi(app);
  return app;
}

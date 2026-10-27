import type { IncomingMessage } from "node:http";
import { RequestMethod, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Logger } from "nestjs-pino";
import { AppModule, type AppOptions } from "./app.module.js";
import type { AppConfig } from "./platform/config.js";
import { mountOpenApi } from "./platform/openapi.js";
import { hardenHttp } from "./platform/http/hardening.js";
import { requestIdFrom } from "./platform/logging/logger.module.js";
import { httpMetrics } from "./platform/metrics/metrics.middleware.js";
import { MetricsService } from "./platform/metrics/metrics.service.js";

/** Create and configure the HTTP app (no listen), shared by main.ts and tests. */
export async function createApp(config: AppConfig, options: AppOptions = {}): Promise<INestApplication> {
  // Fastify (H-12): about 3× Express's throughput for the same Nest app. trustProxy: behind Google's load balancer.
  const adapter = new FastifyAdapter({
    trustProxy: true, routerOptions: { ignoreTrailingSlash: true }, return503OnClosing: false,
    // One id per request: the caller's X-Request-Id when well-formed, else a new one; pino-http reuses it (raw.id).
    genReqId: (raw: IncomingMessage) => {
      const id = requestIdFrom(raw.headers["x-request-id"]);
      (raw as { id?: string }).id = id;
      return id;
    },
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.forRoot(config, options), adapter, { bufferLogs: true, bodyParser: false });
  httpMetrics(app.getHttpAdapter().getInstance(), app.get(MetricsService));
  await hardenHttp(app, config);
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix("v1", { exclude: [{ path: "health", method: RequestMethod.GET }, { path: "health/ready", method: RequestMethod.GET }, { path: "webhooks/*path", method: RequestMethod.POST }, { path: "webhooks/*path", method: RequestMethod.GET }, { path: "metrics", method: RequestMethod.GET }] });
  mountOpenApi(app);
  return app;
}

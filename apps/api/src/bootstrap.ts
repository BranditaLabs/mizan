import { RequestMethod, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { AppModule, type AppOptions } from "./app.module.js";
import type { AppConfig } from "./platform/config.js";
import { mountOpenApi } from "./platform/openapi.js";

/** Create and configure the HTTP app (no listen), shared by main.ts and tests. */
export async function createApp(config: AppConfig, options: AppOptions = {}): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.forRoot(config, options), { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix("v1", { exclude: [{ path: "health", method: RequestMethod.GET }, { path: "health/ready", method: RequestMethod.GET }] });
  const http = app.getHttpAdapter().getInstance() as { disable?: (s: string) => void; set?: (k: string, v: unknown) => void };
  http.disable?.("x-powered-by");
  http.set?.("trust proxy", true);
  mountOpenApi(app);
  return app;
}

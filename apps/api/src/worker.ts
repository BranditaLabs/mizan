import "reflect-metadata";
import { ConfigError, loadConfig } from "./platform/config.js";

/**
 * Worker entry point (same image as the API, ADR-0003): delivers domain events
 * to consumers. Cron handlers and engine jobs join it in E2.
 * Stops cleanly on SIGTERM (Cloud Run): the current batch finishes, leases are released by expiry.
 */
async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
  const { NestFactory } = await import("@nestjs/core");
  const { Logger } = await import("nestjs-pino");
  const { AppModule } = await import("./app.module.js");
  const { EventDispatcher } = await import("./platform/events/dispatcher.js");
  const { EngineJobRunner } = await import("./integrations/engine-runner.js");
  const { RetentionService } = await import("./platform/maintenance/retention.service.js");
  const { exitOnSignals } = await import("./platform/shutdown.js");
  const { Logger: NestLogger } = await import("@nestjs/common");

  // The API process must not also dispatch when a worker runs.
  const app = await NestFactory.createApplicationContext(AppModule.forRoot({ ...config, WORKER_IN_PROCESS: false }), { bufferLogs: true });
  app.useLogger(app.get(Logger));
  exitOnSignals(app, (m) => new NestLogger("Process").log(m));
  app.get(EventDispatcher).start();
  app.get(EngineJobRunner).start();
  app.get(RetentionService).start();
}

void main();

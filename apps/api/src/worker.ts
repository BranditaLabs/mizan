import "reflect-metadata";
import { pino } from "pino";
import { ConfigError, loadConfig } from "./platform/config.js";
import { pinoOptions } from "./platform/logging/logger.module.js";

/**
 * Worker entry point (same image as the API, ADR-0003).
 * The outbox dispatcher and cron handlers arrive with backlog E1-8.
 */
try {
  const config = loadConfig(process.env);
  pino(pinoOptions(config)).warn("worker has no job handlers yet (backlog E1-8); exiting");
} catch (err) {
  if (err instanceof ConfigError) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
  throw err;
}

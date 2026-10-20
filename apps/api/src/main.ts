import "reflect-metadata";
import { ConfigError, loadConfig } from "./platform/config.js";

/**
 * API entry point. The environment is validated before Nest is imported,
 * so a bad deploy fails in milliseconds with a readable list of problems.
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
  const { createApp } = await import("./bootstrap.js");
  const { exitOnSignals } = await import("./platform/shutdown.js");
  const { Logger } = await import("@nestjs/common");
  const app = await createApp(config);
  exitOnSignals(app, (m) => new Logger("Process").log(m));
  await app.listen(config.PORT, "0.0.0.0");
}

void main();

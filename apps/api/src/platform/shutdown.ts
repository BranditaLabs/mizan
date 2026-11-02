import type { INestApplicationContext } from "@nestjs/common";

/**
 * Graceful stop on SIGTERM (Cloud Run) and SIGINT (Ctrl-C): run Nest's
 * shutdown hooks (stop the dispatcher, close the database), then exit 0.
 *
 * Not Nest's enableShutdownHooks(): it re-raises the signal after the hooks,
 * so the process dies by signal, 'exit' never fires, and pino's buffered
 * stdout (flushed on exit) loses the last log lines.
 */
export function exitOnSignals(app: INestApplicationContext, log: (msg: string) => void): void {
  let stopping = false;
  const stop = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    log(`${signal} received, shutting down`);
    const force = setTimeout(() => process.exit(1), 25_000);
    force.unref();
    app.close().then(() => process.exit(0), () => process.exit(1));
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}

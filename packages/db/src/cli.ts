#!/usr/bin/env node
import { migrate } from "./migrate.js";
import { pgMigrationClient } from "./clients.js";

/**
 * `mizan-db migrate` — apply pending migrations as the migrator role.
 * Reads DATABASE_URL_MIGRATOR (falls back to DATABASE_URL). Used by deploy pipelines.
 */
const [command] = process.argv.slice(2);
if (command !== "migrate") {
  process.stderr.write("usage: mizan-db migrate\n");
  process.exit(2);
}
const url = process.env.DATABASE_URL_MIGRATOR ?? process.env.DATABASE_URL;
if (!url) {
  process.stderr.write("DATABASE_URL_MIGRATOR (or DATABASE_URL) is required\n");
  process.exit(1);
}
const client = await pgMigrationClient(url);
try {
  const { applied, skipped } = await migrate(client, { log: (l) => process.stdout.write(`${l}\n`) });
  process.stdout.write(`migrations: ${applied.length} applied, ${skipped.length} already applied\n`);
} finally {
  await client.close();
}

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPglite, pgliteMigrationClient } from "../src/clients.js";
import { generateSchema } from "../src/codegen.js";
import { migrate } from "../src/migrate.js";

// Migrate a fresh in-memory database, introspect it, write src/schema.ts.
const pglite = await createPglite();
const client = pgliteMigrationClient(pglite);
await migrate(client);
const out = fileURLToPath(new URL("../src/schema.ts", import.meta.url));
writeFileSync(out, await generateSchema(client));
await pglite.close();
console.log(`wrote ${out}`);

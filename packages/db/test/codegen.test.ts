import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { pgliteMigrationClient } from "../src/clients.js";
import { generateSchema } from "../src/codegen.js";
import { migrate } from "../src/migrate.js";

it("src/schema.ts matches the migrations (run `npm run codegen -w @mizan/db` after adding one)", async () => {
  const db = new PGlite();
  const client = pgliteMigrationClient(db);
  await migrate(client);
  const fresh = await generateSchema(client);
  const committed = readFileSync(fileURLToPath(new URL("../src/schema.ts", import.meta.url)), "utf8");
  expect(committed).toBe(fresh);
  await db.close();
});

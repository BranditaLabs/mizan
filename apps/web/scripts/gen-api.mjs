// Types for the API client from apps/api/openapi.json (E4-4): `npm run gen:api -w @mizan/web`.
// test/api-schema.test.ts fails when the committed file is stale.
import { readFileSync, writeFileSync } from "node:fs";
import openapiTS, { astToString } from "openapi-typescript";

export const SPEC = new URL("../../api/openapi.json", import.meta.url);
export const OUT = new URL("../src/lib/api/schema.d.ts", import.meta.url);
const HEADER = "/* Generated from apps/api/openapi.json by `npm run gen:api -w @mizan/web`. Do not edit. */\n\n";

export async function generate() {
  const ast = await openapiTS(JSON.parse(readFileSync(SPEC, "utf8")));
  return HEADER + astToString(ast);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writeFileSync(OUT, await generate());
  console.log(`wrote ${OUT.pathname}`);
}

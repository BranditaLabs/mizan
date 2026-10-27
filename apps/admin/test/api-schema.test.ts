import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generate, OUT } from "../scripts/gen-api.mjs";

describe("API client types", () => {
  it("are generated from the current openapi.json (npm run gen:api -w @mizan/admin)", async () => {
    expect(readFileSync(OUT, "utf8")).toBe(await generate());
  });
});

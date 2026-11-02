import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) }, conditions: ["source"] },
  test: { include: ["test/**/*.test.ts"], environment: "node", testTimeout: 60_000 },
});

import { defineConfig } from "vitest/config";

// @mizan/shared from source (its "source" export condition), like the apps' bundlers.
export default defineConfig({
  resolve: { conditions: ["source"] },
});

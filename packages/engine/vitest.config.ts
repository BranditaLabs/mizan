import { defineConfig } from "vitest/config";

// Resolve workspace packages (@mizan/shared) to their TypeScript source.
export default defineConfig({
  resolve: { conditions: ["source"] },
});

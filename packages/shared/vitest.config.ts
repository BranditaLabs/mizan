import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts", "src/model.ts"],
      reporter: ["text-summary"],
      // Money is the one place a rounding bug loses real cash: hold it to 100%.
      thresholds: {
        "src/money.ts": { statements: 100, branches: 100, functions: 100, lines: 100 },
      },
    },
  },
});

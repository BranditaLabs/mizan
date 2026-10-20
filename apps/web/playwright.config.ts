import { defineConfig, devices } from "@playwright/test";

/** Smoke test of the production build in both directions and both themes (E4-1). */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://localhost:3100", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: { command: "npx next start --port 3100", url: "http://localhost:3100/ar", reuseExistingServer: !process.env.CI, timeout: 60_000 },
});

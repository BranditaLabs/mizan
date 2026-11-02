import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { ADMIN, API, apiEnv, EMULATOR } from "./e2e/env.mjs";

/**
 * The back office end to end on its production build (`npm run build:e2e` first), against the
 * Firebase Auth emulator and the real API (PGlite). The emulator needs Java 21.
 */
const emulatorConfig = fileURLToPath(new URL("./e2e/firebase.json", import.meta.url));

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL: ADMIN, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `npx -y firebase-tools@15.34.0 emulators:start --only auth --project demo-mizan --config "${emulatorConfig}"`,
      cwd: "e2e",
      stdout: "pipe",
      url: EMULATOR,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    { command: "node ../api/dist/main.js", url: `${API}/health`, env: apiEnv, reuseExistingServer: false, timeout: 60_000 },
    { command: `npx next start --port ${new URL(ADMIN).port}`, url: `${ADMIN}/en/sign-in`, reuseExistingServer: !process.env.CI, timeout: 60_000 },
  ],
});

import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { API, apiEnv, EMULATOR, WEB } from "./e2e/env.mjs";

/**
 * End to end on the production build (`npm run build:e2e` first): smoke (both directions, both
 * themes) and the sign-in journeys against the Firebase Auth emulator and the real API (PGlite).
 * The emulator needs Java 21 (firebase-tools downloads its jar on first run).
 */
// firebase-tools does not resolve a relative --config against the working directory: pass it absolute.
const emulatorConfig = fileURLToPath(new URL("./e2e/firebase.json", import.meta.url));

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL: WEB, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `npx -y firebase-tools@15.34.0 emulators:start --only auth --project demo-mizan --config "${emulatorConfig}"`,
      cwd: "e2e", // its debug log lands here (ignored)
      stdout: "pipe", // start-up problems show in the CI log
      url: EMULATOR,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    { command: "node ../api/dist/main.js", url: `${API}/health`, env: apiEnv, reuseExistingServer: !process.env.CI, timeout: 60_000 },
    { command: `npx next start --port ${new URL(WEB).port}`, url: `${WEB}/ar/sign-in`, reuseExistingServer: !process.env.CI, timeout: 60_000 },
  ],
});

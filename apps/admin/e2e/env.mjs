/**
 * The back office's end-to-end stack: the Firebase Auth emulator (shared with apps/web's, project
 * demo-mizan) + the real API on PGlite with a bootstrap super admin + this app's production build.
 */
export const EMULATOR = "http://127.0.0.1:9099";
export const API = "http://localhost:8091";
export const ADMIN = "http://localhost:3101";
export const PROJECT = "demo-mizan";

// One per run: the config sets it before the workers start, and they inherit it.
process.env.E2E_BOSS ??= `boss-${Date.now()}@example.com`;
export const BOSS = process.env.E2E_BOSS;

export const adminEnv = {
  NEXT_PUBLIC_API_URL: API,
  NEXT_PUBLIC_FIREBASE_API_KEY: "demo-key",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: PROJECT,
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: `${PROJECT}.firebaseapp.com`,
  NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL: EMULATOR,
};

export const apiEnv = {
  NODE_ENV: "development",
  PORT: "8091",
  LOG_LEVEL: "warn",
  PUBLIC_URL: API,
  WEB_URL: "http://localhost:3100",
  ADMIN_URL: ADMIN,
  FIREBASE_PROJECT_ID: PROJECT,
  FIREBASE_AUTH_EMULATOR_HOST: new URL(EMULATOR).host,
  AUTH_REQUIRE_MFA: "true",
  FX_SOURCE: "none",
  PLATFORM_BOOTSTRAP_EMAILS: BOSS,
};

/**
 * The end-to-end stack: Firebase Auth emulator (project demo-mizan) + the real API on PGlite +
 * the production build of this app, all on localhost. `npm run build:e2e` bakes the browser side in.
 */
export const EMULATOR = "http://127.0.0.1:9099";
export const API = "http://localhost:8090";
export const WEB = "http://localhost:3100";
export const PROJECT = "demo-mizan";

/** NEXT_PUBLIC_* for `next build` (the emulator ignores the API key). */
export const webEnv = {
  NEXT_PUBLIC_API_URL: API,
  NEXT_PUBLIC_FIREBASE_API_KEY: "demo-key",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: PROJECT,
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: `${PROJECT}.firebaseapp.com`,
  NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL: EMULATOR,
};

/** apps/api with unsigned emulator tokens and the production MFA rule for owners and admins. */
export const apiEnv = {
  NODE_ENV: "development",
  PORT: "8090",
  LOG_LEVEL: "warn",
  PUBLIC_URL: API,
  WEB_URL: WEB,
  FIREBASE_PROJECT_ID: PROJECT,
  FIREBASE_AUTH_EMULATOR_HOST: new URL(EMULATOR).host,
  AUTH_REQUIRE_MFA: "true",
};

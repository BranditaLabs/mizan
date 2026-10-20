import { z } from "zod";

/**
 * Environment configuration, validated once at startup.
 *
 * Every variable the API reads is declared here (docs/09 §3). An invalid
 * environment stops the process before Nest boots, with one line per bad
 * variable. Values are never echoed: a mistyped secret must not end up in
 * Cloud Logging.
 */

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;

const url = z.url({ protocol: /^https?$/, error: "must be an http(s) URL" });
const optionalString = z.string().trim().min(1).optional();

export const ConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number({ error: "must be a number" }).int().min(1).max(65535).default(8080),
  LOG_LEVEL: z.enum(LOG_LEVELS, { error: `must be one of ${LOG_LEVELS.join(", ")}` }).default("info"),

  PUBLIC_URL: url,
  WEB_URL: url,
  /** Staff admin app (E17); allowed by CORS when set. */
  ADMIN_URL: url.optional(),
  /** Requests per minute per client IP (checked before sign-in) and per signed-in user. 0 disables. */
  RATE_LIMIT_IP_PER_MIN: z.coerce.number().int().min(0).default(1200),
  RATE_LIMIT_USER_PER_MIN: z.coerce.number().int().min(0).default(600),
  /** Auth hot-path caches (H-6). A member disabled on another instance loses access within the membership TTL. */
  AUTH_USER_CACHE_MS: z.coerce.number().int().min(0).max(600_000).default(60_000),
  AUTH_MEMBERSHIP_CACHE_MS: z.coerce.number().int().min(0).max(60_000).default(10_000),
  /** Largest provider webhook body accepted (bytes). */
  WEBHOOK_MAX_BODY_BYTES: z.coerce.number().int().min(1024).max(50 * 1024 * 1024).default(5 * 1024 * 1024),
  /** Largest JSON body accepted (bytes). Webhooks and imports have their own limits. */
  MAX_BODY_BYTES: z.coerce.number().int().min(1024).max(50 * 1024 * 1024).default(1024 * 1024),

  // Database. postgres://… in staging/production. Unset in development/test = in-memory
  // PGlite with migrations applied at boot; "pglite:<dir>" keeps local data between runs.
  DATABASE_URL: z.string().trim().regex(/^(postgres(ql)?:\/\/|pglite:)/, "must be a postgres:// URL or pglite:<dir>").optional(),
  DATABASE_URL_MIGRATOR: optionalString,
  DATABASE_POOL_MAX: z.coerce.number({ error: "must be a number" }).int().min(1).max(100).default(10),

  // Auth. Without a project id (local dev) every protected route answers 401 auth_not_configured.
  FIREBASE_PROJECT_ID: optionalString,
  // Owners/admins must use a second factor. Unset = on in production, off elsewhere.
  AUTH_REQUIRE_MFA: z.stringbool({ error: "must be true or false" }).optional(),

  // Run the background loops (domain events, engine jobs) inside the API process. Unset = on only
  // in development with PGlite (one process, no separate worker); production runs `node dist/worker.js`.
  WORKER_IN_PROCESS: z.stringbool({ error: "must be true or false" }).optional(),

  // Integrations (engine). The Shopify app's client secret verifies webhook HMACs (E3).
  SHOPIFY_API_SECRET: optionalString,
  BOSTA_BASE_URL: url.optional(),
  BOSTA_TRACKING_URL_TEMPLATE: z.string().includes("{tn}", { error: "must contain {tn}" }).optional(),

  // Secrets: Cloud KMS key that wraps per-secret data keys (required in production).
  KMS_KEY_NAME: optionalString,
  // Development only: base64 of 32 random bytes (openssl rand -base64 32). Unset = ephemeral key.
  SECRETS_DEV_KEY: z.string().refine((v) => Buffer.from(v, "base64").length === 32, "must be base64 of exactly 32 bytes").optional(),

  // Shopify app (E3)
  SHOPIFY_API_VERSION: z.string().regex(/^\d{4}-\d{2}$/, "must look like 2026-10").default("2026-10"),

  SENTRY_DSN: optionalString,
}).superRefine((env, ctx) => {
  if (env.NODE_ENV === "production" && !env.DATABASE_URL?.startsWith("postgres")) {
    ctx.addIssue({ code: "custom", path: ["DATABASE_URL"], message: "a postgres:// URL is required in production" });
  }
  if (env.NODE_ENV === "production" && !env.KMS_KEY_NAME) {
    ctx.addIssue({ code: "custom", path: ["KMS_KEY_NAME"], message: "is required in production" });
  }
  if (env.NODE_ENV === "production" && env.SECRETS_DEV_KEY) {
    ctx.addIssue({ code: "custom", path: ["SECRETS_DEV_KEY"], message: "must not be set in production (use KMS_KEY_NAME)" });
  }
  if (env.NODE_ENV === "production" && !env.FIREBASE_PROJECT_ID) {
    ctx.addIssue({ code: "custom", path: ["FIREBASE_PROJECT_ID"], message: "is required in production" });
  }
});

export type AppConfig = z.infer<typeof ConfigSchema>;

/** Whether this process runs the background loops (see WORKER_IN_PROCESS). */
export const runsWorkerInProcess = (c: AppConfig) =>
  c.WORKER_IN_PROCESS ?? (c.NODE_ENV === "development" && !c.DATABASE_URL?.startsWith("postgres"));

/** Injection token for the parsed config. */
export const APP_CONFIG = Symbol("APP_CONFIG");

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "ConfigError";
  }
}

/** Parse and validate the environment. Throws ConfigError listing every problem (names and reasons, never values). */
export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  // Treat empty strings as unset so `FOO=` in a .env file falls back to the default.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ""));
  const result = ConfigSchema.safeParse(cleaned);
  if (result.success) return result.data;
  const problems = result.error.issues.map((issue) => {
    const name = issue.path.join(".") || "(environment)";
    const reason = issue.code === "invalid_type" && !(name in cleaned) ? "is required" : issue.message;
    return `${name}: ${reason}`;
  });
  throw new ConfigError(problems);
}

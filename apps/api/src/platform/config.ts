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

  // Database. postgres://… in staging/production. Unset in development/test = in-memory
  // PGlite with migrations applied at boot; "pglite:<dir>" keeps local data between runs.
  DATABASE_URL: z.string().trim().regex(/^(postgres(ql)?:\/\/|pglite:)/, "must be a postgres:// URL or pglite:<dir>").optional(),
  DATABASE_URL_MIGRATOR: optionalString,
  DATABASE_POOL_MAX: z.coerce.number({ error: "must be a number" }).int().min(1).max(100).default(10),

  // Auth (E1-5)
  FIREBASE_PROJECT_ID: optionalString,

  // Secrets (E1-10)
  KMS_KEY_NAME: optionalString,

  // Shopify app (E3)
  SHOPIFY_API_VERSION: z.string().regex(/^\d{4}-\d{2}$/, "must look like 2026-10").default("2026-10"),

  SENTRY_DSN: optionalString,
}).superRefine((env, ctx) => {
  if (env.NODE_ENV === "production" && !env.DATABASE_URL?.startsWith("postgres")) {
    ctx.addIssue({ code: "custom", path: ["DATABASE_URL"], message: "a postgres:// URL is required in production" });
  }
});

export type AppConfig = z.infer<typeof ConfigSchema>;

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

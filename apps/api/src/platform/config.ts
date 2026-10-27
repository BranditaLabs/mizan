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

/**
 * docs/06 §3. `read_all_orders` (orders older than 60 days) needs Shopify's approval first.
 * write_orders: mark paid, tags (E2-6); write_order_edits: accepted offers join the order (E6-13).
 */
export const SHOPIFY_DEFAULT_SCOPES = [
  "read_orders", "write_orders", "write_order_edits", "read_products", "write_products", "read_inventory", "write_inventory",
  "read_merchant_managed_fulfillment_orders", "write_merchant_managed_fulfillment_orders", "read_customers",
].join(",");

const url = z.url({ protocol: /^https?$/, error: "must be an http(s) URL" });
const optionalString = z.string().trim().min(1).optional();

export const ConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number({ error: "must be a number" }).int().min(1).max(65535).default(8080),
  LOG_LEVEL: z.enum(LOG_LEVELS, { error: `must be one of ${LOG_LEVELS.join(", ")}` }).default("info"),
  /** Unset = pretty in development (needs the pino-pretty dev dependency), JSON elsewhere. The image always logs JSON. */
  LOG_FORMAT: z.enum(["json", "pretty"], { error: "must be json or pretty" }).optional(),

  PUBLIC_URL: url,
  WEB_URL: url,
  /** Staff admin app (E17); allowed by CORS when set. */
  ADMIN_URL: url.optional(),
  /** Bearer token for GET /metrics (Prometheus / Cloud Monitoring scraper). Unset = endpoint disabled. */
  METRICS_TOKEN: z.string().min(24, "must be at least 24 characters").optional(),
  /** Requests per minute per client IP (checked before sign-in) and per signed-in user. 0 disables. */
  RATE_LIMIT_IP_PER_MIN: z.coerce.number().int().min(0).default(1200),
  RATE_LIMIT_USER_PER_MIN: z.coerce.number().int().min(0).default(600),
  /** Auth hot-path caches (H-6). A member disabled on another instance loses access within the membership TTL. */
  AUTH_USER_CACHE_MS: z.coerce.number().int().min(0).max(600_000).default(60_000),
  AUTH_MEMBERSHIP_CACHE_MS: z.coerce.number().int().min(0).max(60_000).default(10_000),
  /** Retention of high-churn tables (H-7), in days. */
  RETENTION_JOBS_DAYS: z.coerce.number().int().min(1).max(365).default(7),
  RETENTION_WEBHOOK_KEYS_DAYS: z.coerce.number().int().min(3).max(365).default(14),
  RETENTION_EVENTS_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  /** Signs customer confirmation links (E6-7): base64 of 32 random bytes. Required in production; a fixed dev key elsewhere. */
  LINK_SIGNING_KEY: z.string().refine((v) => Buffer.from(v, "base64").length === 32, "must be base64 of exactly 32 bytes").optional(),
  /** Customer messaging for confirmation (E6-7): none = links are sent by hand; log = development, pretends every channel is connected. */
  MESSAGING_PROVIDER: z.enum(["none", "log"], { error: "must be none or log" }).default("none"),
  /** WhatsApp Cloud API (E6-10): the Meta app's secret signs webhooks; the verify token answers Meta's subscription check. Unset = WhatsApp webhooks refused. */
  META_APP_SECRET: z.string().min(16).optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().min(16).optional(),
  /** Graph API base and version (tests point it at a fake server). */
  WHATSAPP_GRAPH_URL: url.default("https://graph.facebook.com"),
  /** Claude writes and picks offers (E6-12). Unset = offers keep Mizan's own choice and wording. */
  ANTHROPIC_API_KEY: z.string().min(20).optional(),
  ANTHROPIC_MODEL: z.string().regex(/^claude-[a-z0-9-]+$/, "a Claude model id").default("claude-opus-5-5"),
  ANTHROPIC_BASE_URL: url.default("https://api.anthropic.com"),
  WHATSAPP_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/, "like v24.0").default("v24.0"),
  /** Daily exchange rates (E9-1): the feed, and how often the worker checks whether today's rates are in. Unset = open-er-api, none in tests. */
  FX_SOURCE: z.enum(["open-er-api", "none"], { error: "must be open-er-api or none" }).optional(),
  FX_REFRESH_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),
  /** Largest provider webhook body accepted (bytes). */
  WEBHOOK_MAX_BODY_BYTES: z.coerce.number().int().min(1024).max(50 * 1024 * 1024).default(5 * 1024 * 1024),
  /** Largest JSON body accepted (bytes). Webhooks and imports have their own limits. */
  MAX_BODY_BYTES: z.coerce.number().int().min(1024).max(50 * 1024 * 1024).default(1024 * 1024),

  // Database. postgres://… in staging/production. Unset in development/test = in-memory
  // PGlite with migrations applied at boot; "pglite:<dir>" keeps local data between runs.
  DATABASE_URL: z.string().trim().regex(/^(postgres(ql)?:\/\/|pglite:)/, "must be a postgres:// URL or pglite:<dir>").optional(),
  DATABASE_URL_MIGRATOR: optionalString,
  DATABASE_POOL_MAX: z.coerce.number({ error: "must be a number" }).int().min(1).max(100).default(10),
  /** Per-statement timeout (ms). The worker may raise it for batch work. */
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(100).max(600_000).default(15_000),
  /** Statements slower than this are logged (SQL text only). */
  DATABASE_SLOW_QUERY_MS: z.coerce.number().int().min(1).max(600_000).default(500),

  // Auth. Without a project id (local dev) every protected route answers 401 auth_not_configured.
  FIREBASE_PROJECT_ID: optionalString,
  /** host:port of the Firebase Auth emulator (development and tests): unsigned tokens are accepted. Refused in production. */
  FIREBASE_AUTH_EMULATOR_HOST: z.string().regex(/^[\w.-]+:\d+$/, "must be host:port").optional(),
  // Owners/admins must use a second factor. Unset = on in production, off elsewhere.
  AUTH_REQUIRE_MFA: z.stringbool({ error: "must be true or false" }).optional(),
  /**
   * A-1: verified emails that become the first Mizan staff (super_admin) on their first back-office
   * call, so a fresh install has someone to add the rest. Comma-separated; empty = nobody.
   */
  PLATFORM_BOOTSTRAP_EMAILS: z.string().optional(),

  // Run the background loops (domain events, engine jobs) inside the API process. Unset = on only
  // in development with PGlite (one process, no separate worker); production runs `node dist/worker.js`.
  WORKER_IN_PROCESS: z.stringbool({ error: "must be true or false" }).optional(),

  // Integrations (engine). Shopify app credentials (Partner Dashboard → app → Client credentials):
  // the client id starts OAuth; the client secret signs OAuth callbacks and webhooks (E3).
  SHOPIFY_API_KEY: optionalString,
  SHOPIFY_API_SECRET: optionalString,
  /** Access scopes requested on install (docs/06 §3). Comma-separated. */
  SHOPIFY_SCOPES: z.string().regex(/^[a-z_]+(,[a-z_]+)*$/, "must be comma-separated scope names").default(SHOPIFY_DEFAULT_SCOPES),
  /** Shopify stores one account can connect (E2-7) until plan limits (E12-1) decide it per plan. */
  MAX_SHOPIFY_STORES: z.coerce.number().int().min(1).max(50).default(3),
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
  if (env.NODE_ENV === "production" && !env.LINK_SIGNING_KEY) {
    ctx.addIssue({ code: "custom", path: ["LINK_SIGNING_KEY"], message: "is required in production" });
  }
  if (env.NODE_ENV === "production" && env.MESSAGING_PROVIDER === "log") {
    ctx.addIssue({ code: "custom", path: ["MESSAGING_PROVIDER"], message: "log is for development only" });
  }
  if (env.NODE_ENV === "production" && !env.KMS_KEY_NAME) {
    ctx.addIssue({ code: "custom", path: ["KMS_KEY_NAME"], message: "is required in production" });
  }
  if (env.NODE_ENV === "production" && env.SECRETS_DEV_KEY) {
    ctx.addIssue({ code: "custom", path: ["SECRETS_DEV_KEY"], message: "must not be set in production (use KMS_KEY_NAME)" });
  }
  if (env.NODE_ENV === "production" && env.FIREBASE_AUTH_EMULATOR_HOST) {
    ctx.addIssue({ code: "custom", path: ["FIREBASE_AUTH_EMULATOR_HOST"], message: "must not be set in production (unsigned tokens)" });
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

/** Which FX feed the worker uses (none in tests: they pass a fake source). */
export const fxSourceOf = (c: AppConfig): "open-er-api" | "none" => c.FX_SOURCE ?? (c.NODE_ENV === "test" ? "none" : "open-er-api");

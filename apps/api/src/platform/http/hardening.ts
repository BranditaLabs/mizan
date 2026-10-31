import type { Server } from "node:http";
import compress from "@fastify/compress";
import helmet from "@fastify/helmet";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config.js";
import { ProblemError } from "./problem.js";

/** Headers browsers may send to the API (docs/05 conventions). */
const ALLOWED_HEADERS = ["Authorization", "Content-Type", "X-Tenant-Id", "Idempotency-Key", "If-Match", "Accept-Language", "X-Request-Id"];
/** Headers the web apps may read. */
const EXPOSED_HEADERS = ["X-Request-Id", "ETag", "Retry-After", "RateLimit", "RateLimit-Policy", "Idempotency-Replayed"];

const isWebhook = (url: string) => url.startsWith("/webhooks/");


/**
 * Production HTTP posture for a JSON API behind Google's load balancer (on Fastify, H-12):
 * security headers, a strict CORS allowlist, body limits, compression. Webhooks get the exact
 * bytes received (signatures are computed over them) and their own size cap; everything else
 * is JSON (or a form) up to MAX_BODY_BYTES. Malformed or oversized bodies become problem+json (ProblemFilter).
 */
export async function hardenHttp(app: NestFastifyApplication, config: AppConfig): Promise<void> {
  const fastify = app.getHttpAdapter().getInstance() as unknown as FastifyInstance;
  // Every response carries its request id (pino-http only sees requests it logs).
  fastify.addHook("onRequest", (req, reply, done) => {
    void reply.header("X-Request-Id", req.id);
    done();
  });

  await app.register(helmet as never, {
    // A JSON API renders nothing: forbid everything a browser could load from it.
    contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: "same-site" },
    frameguard: { action: "deny" },
    referrerPolicy: { policy: "no-referrer" },
    strictTransportSecurity: config.NODE_ENV === "production" ? { maxAge: 63_072_000, includeSubDomains: true, preload: true } : false,
  });

  const origins = [config.WEB_URL, config.ADMIN_URL].filter((o): o is string => Boolean(o)).map((o) => new URL(o).origin);
  app.enableCors({
    // No Origin header (server-to-server, curl): CORS does not apply. Unknown origins get no CORS headers.
    origin: (origin: string | undefined, done: (err: Error | null, allow: string | boolean) => void) =>
      done(null, origin !== undefined && origins.includes(origin) ? origin : false),
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
    allowedHeaders: ALLOWED_HEADERS,
    exposedHeaders: EXPOSED_HEADERS,
    credentials: false, // bearer tokens, never cookies
    maxAge: 600,
  });

  await app.register(compress as never, { threshold: 1024, encodings: ["br", "gzip", "deflate"] });

  // Bodies: one parser for every content type. Webhooks keep their bytes (no parsing, no
  // rejection of an odd content type); the API takes JSON and forms within its own limit.
  fastify.removeAllContentTypeParsers();
  const limitFor = (url: string) => (isWebhook(url) ? config.WEBHOOK_MAX_BODY_BYTES : config.MAX_BODY_BYTES);
  fastify.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: Math.max(config.WEBHOOK_MAX_BODY_BYTES, config.MAX_BODY_BYTES) }, (req, body, done) => {
    const buf = body as Buffer;
    if (buf.length > limitFor(req.url)) return done(new ProblemError(413, "payload_too_large", `the body is larger than ${limitFor(req.url)} bytes`), undefined);
    if (isWebhook(req.url)) return done(null, buf);
    if (buf.length === 0) return done(null, undefined);
    const type = (req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
    if (type === "application/json" || type.endsWith("+json")) {
      try {
        return done(null, JSON.parse(buf.toString("utf8")));
      } catch {
        return done(new ProblemError(400, "bad_request", "the body is not valid JSON"), undefined);
      }
    }
    if (type === "application/x-www-form-urlencoded") return done(null, Object.fromEntries(new URLSearchParams(buf.toString("utf8"))));
    return done(null, undefined); // other types carry nothing the API reads
  });

  // Parse errors are ProblemErrors and Fastify's own (FST_ERR_CTP_*) are mapped in ProblemFilter: Nest owns the error handler.
}

/**
 * Keep idle connections open longer than Google's front end (which reuses them for
 * up to 600 s), so the load balancer never sends a request on a socket we just closed.
 */
export function tuneServer(server: Server): void {
  server.keepAliveTimeout = 620_000;
  server.headersTimeout = 625_000;
  server.requestTimeout = 60_000;
}

import type { Server } from "node:http";
import type { NestExpressApplication } from "@nestjs/platform-express";
import compression from "compression";
import helmet from "helmet";
import type { NextFunction, Request, Response } from "express";
import type { AppConfig } from "../config.js";
import { PROBLEM_CONTENT_TYPE, problemType } from "./problem.js";

/** Headers browsers may send to the API (docs/05 conventions). */
const ALLOWED_HEADERS = ["Authorization", "Content-Type", "X-Tenant-Id", "Idempotency-Key", "If-Match", "Accept-Language", "X-Request-Id"];
/** Headers the web apps may read. */
const EXPOSED_HEADERS = ["X-Request-Id", "ETag", "Retry-After", "RateLimit", "RateLimit-Policy", "Idempotency-Replayed"];

/**
 * Production HTTP posture for a JSON API behind Google's load balancer:
 * security headers, a strict CORS allowlist, body limits, compression and
 * server timeouts that outlive the load balancer's idle connections.
 */
export function hardenHttp(app: NestExpressApplication, config: AppConfig): void {
  const express = app.getHttpAdapter().getInstance() as { set(k: string, v: unknown): void; disable(k: string): void };
  express.disable("x-powered-by");
  express.set("trust proxy", true);
  // Strings above this length are not parsed as numbers etc.; keep query parsing simple.
  express.set("query parser", "simple");

  app.use(helmet({
    // A JSON API renders nothing: forbid everything a browser could load from it.
    contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: "same-site" },
    frameguard: { action: "deny" },
    referrerPolicy: { policy: "no-referrer" },
    strictTransportSecurity: config.NODE_ENV === "production" ? { maxAge: 63_072_000, includeSubDomains: true, preload: true } : false,
  }));

  const origins = [config.WEB_URL, config.ADMIN_URL].filter((o): o is string => Boolean(o)).map((o) => new URL(o).origin);
  app.enableCors({
    // No Origin header (server-to-server, curl): CORS does not apply. Unknown origins get no CORS headers.
    origin: (origin: string | undefined, done: (err: Error | null, allow?: string | boolean) => void) =>
      done(null, origin !== undefined && origins.includes(origin) ? origin : false),
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
    allowedHeaders: ALLOWED_HEADERS,
    exposedHeaders: EXPOSED_HEADERS,
    credentials: false, // bearer tokens, never cookies
    maxAge: 600,
  });

  app.use(compression({ threshold: 1024 }));
  app.useBodyParser("json", { limit: config.MAX_BODY_BYTES });
  app.useBodyParser("urlencoded", { limit: config.MAX_BODY_BYTES, extended: false });

  // Malformed JSON and oversized bodies become problem+json, not HTML.
  app.use((err: Error & { type?: string; status?: number }, req: Request, res: Response, next: NextFunction) => {
    if (err?.type === "entity.too.large" || err?.type === "entity.parse.failed") {
      const tooLarge = err.type === "entity.too.large";
      const code = tooLarge ? "payload_too_large" : "bad_request";
      res.status(tooLarge ? 413 : 400).type(PROBLEM_CONTENT_TYPE).send(JSON.stringify({
        type: problemType(code), title: tooLarge ? "Request too large" : "Bad request", status: tooLarge ? 413 : 400, code,
        detail: tooLarge ? `the body is larger than ${config.MAX_BODY_BYTES} bytes` : "the body is not valid JSON",
        ...(req.id ? { requestId: String(req.id) } : {}),
      }));
      return;
    }
    next(err);
  });
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

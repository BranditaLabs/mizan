import type { FastifyInstance } from "fastify";
import { routeTemplate } from "../http/http.types.js";
import type { MetricsService } from "./metrics.service.js";

// Label values come from a fixed set: a URL segment would let anyone mint new series.
const PROVIDERS = new Set(["shopify", "bosta"]);

/** Times every request (Fastify hooks); the label is the matched route template, or "unmatched". */
export function httpMetrics(fastify: FastifyInstance, metrics: MetricsService): void {
  fastify.addHook("onResponse", (req, reply, done) => {
    const status = reply.statusCode;
    metrics.httpDuration.observe({ method: req.method, route: routeTemplate(req), status: `${Math.floor(status / 100)}xx` }, reply.elapsedTime / 1000);
    if (req.url.startsWith("/webhooks/")) {
      const provider = req.url.split(/[/?]/)[2] ?? "";
      metrics.webhooks.inc({ provider: PROVIDERS.has(provider) ? provider : "other", status: String(status) });
    }
    if (status === 429) metrics.rateLimited.inc({ policy: String(reply.getHeader("RateLimit-Policy") ?? "").includes("ip") ? "ip" : "user" });
    if (reply.getHeader("Idempotency-Replayed")) metrics.idempotentReplays.inc();
    done();
  });
}

import type { NextFunction, Request, Response } from "express";
import type { MetricsService } from "./metrics.service.js";

// Label values come from a fixed set: a URL segment would let anyone mint new series.
const PROVIDERS = new Set(["shopify", "bosta"]);

/** Times every request; the label is the matched route template, or "unmatched". */
export function httpMetrics(metrics: MetricsService) {
  return (req: Request, res: Response, next: NextFunction) => {
    const end = metrics.httpDuration.startTimer({ method: req.method });
    res.on("finish", () => {
      const route = (req.route?.path as string | undefined) ?? "unmatched";
      const path = req.baseUrl ? `${req.baseUrl}${route}` : route;
      end({ route: path, status: `${Math.floor(res.statusCode / 100)}xx` });
      if (req.path.startsWith("/webhooks/")) {
        const provider = req.path.split("/")[2] ?? "";
        metrics.webhooks.inc({ provider: PROVIDERS.has(provider) ? provider : "other", status: String(res.statusCode) });
      }
      if (res.statusCode === 429) metrics.rateLimited.inc({ policy: String(res.getHeader("RateLimit-Policy") ?? "").includes("ip") ? "ip" : "user" });
      if (res.getHeader("Idempotency-Replayed")) metrics.idempotentReplays.inc();
    });
    next();
  };
}

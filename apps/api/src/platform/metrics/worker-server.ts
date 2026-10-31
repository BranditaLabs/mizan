import { createServer, type Server } from "node:http";
import { scrapeDenied } from "./metrics.controller.js";
import type { MetricsService } from "./metrics.service.js";

/**
 * The worker's only HTTP surface: GET /health (Cloud Run probe) and GET /metrics
 * (same token rule as the API). Engine jobs run here, so circuit and queue metrics do too.
 */
export function startWorkerServer(port: number, metrics: MetricsService, token: string | undefined): Promise<Server> {
  const server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (req.method === "GET" && path === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ status: "ok", role: "worker" }));
      return;
    }
    if (req.method === "GET" && path === "/metrics") {
      const denied = scrapeDenied(token, req.headers.authorization);
      if (denied) return void res.writeHead(denied).end();
      metrics.registry.metrics().then(
        (body) => res.writeHead(200, { "Content-Type": metrics.registry.contentType }).end(body),
        () => res.writeHead(500).end(),
      );
      return;
    }
    res.writeHead(404).end();
  });
  server.keepAliveTimeout = 65_000;
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

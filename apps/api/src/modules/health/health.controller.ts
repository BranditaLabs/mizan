import { Controller, Get, Inject } from "@nestjs/common";
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from "@nestjs/swagger";
import { Public } from "../../platform/auth/decorators.js";
import { Database } from "../../platform/db/database.js";
import { ProblemError } from "../../platform/http/problem.js";
import { APP_VERSION } from "../../version.js";

const startedAt = Date.now();

export interface HealthResponse {
  status: "ok";
  version: string;
  uptimeS: number;
  time: string;
}

/** Probes for Cloud Run and the load balancer. Served outside /v1. */
@ApiTags("platform")
@Public()
@Controller("health")
export class HealthController {
  constructor(@Inject(Database) private readonly db: Database) {}

  /** Liveness: the process is up. Never touches dependencies, so a slow DB does not restart instances. */
  @Get()
  @ApiOkResponse({ description: "The process is up." })
  live(): HealthResponse {
    return {
      status: "ok",
      version: APP_VERSION,
      uptimeS: Math.round((Date.now() - startedAt) / 1000),
      time: new Date().toISOString(),
    };
  }

  /** Readiness: the database answers. Traffic is routed only to ready instances. */
  @Get("ready")
  @ApiOkResponse({ description: "Ready to serve traffic." })
  @ApiServiceUnavailableResponse({ description: "A dependency is down." })
  async ready(): Promise<{ status: "ready" }> {
    try {
      await this.db.ping();
    } catch {
      throw new ProblemError(503, "service_unavailable", "database unreachable");
    }
    return { status: "ready" };
  }
}

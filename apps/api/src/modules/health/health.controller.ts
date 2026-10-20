import { Controller, Get, Inject } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { Public } from "../../platform/auth/decorators.js";
import { Database } from "../../platform/db/database.js";
import { ApiJson, ApiProblems } from "../../platform/http/api-schema.js";
import { ProblemError } from "../../platform/http/problem.js";
import { APP_VERSION } from "../../version.js";

const startedAt = Date.now();

const HealthSchema = z.object({ status: z.literal("ok"), version: z.string(), uptimeS: z.number().int(), time: z.iso.datetime() });
export type HealthResponse = z.infer<typeof HealthSchema>;
const ReadySchema = z.object({ status: z.literal("ready") });

/** Probes for Cloud Run and the load balancer. Served outside /v1. */
@ApiTags("platform")
@Public()
@Controller("health")
export class HealthController {
  constructor(@Inject(Database) private readonly db: Database) {}

  /** Liveness: the process is up. Never touches dependencies, so a slow DB does not restart instances. */
  @Get()
  @ApiJson(200, "Health", HealthSchema, "The process is up")
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
  @ApiJson(200, "Ready", ReadySchema, "Ready to serve traffic")
  @ApiProblems(503)
  async ready(): Promise<{ status: "ready" }> {
    try {
      await this.db.ping();
    } catch {
      throw new ProblemError(503, "service_unavailable", "database unreachable");
    }
    return { status: "ready" as const };
  }
}

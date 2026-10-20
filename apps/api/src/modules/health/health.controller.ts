import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { APP_VERSION } from "../../version.js";

const startedAt = Date.now();

export interface HealthResponse {
  status: "ok";
  version: string;
  uptimeS: number;
  time: string;
}

/** Liveness probe for Cloud Run and the load balancer. Served outside /v1. */
@ApiTags("platform")
@Controller("health")
export class HealthController {
  @Get()
  @ApiOkResponse({ description: "The process is up." })
  get(): HealthResponse {
    return {
      status: "ok",
      version: APP_VERSION,
      uptimeS: Math.round((Date.now() - startedAt) / 1000),
      time: new Date().toISOString(),
    };
  }
}

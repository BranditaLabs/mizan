import { Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query, UseGuards, UseInterceptors } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { z } from "zod";
import { Auth, NoTenant } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { ApiJson, ApiProblems, ApiQueryZod } from "../../platform/http/api-schema.js";
import { ZodPipe } from "../../platform/http/zod.pipe.js";
import { DeadLettersQuerySchema, PlatformDeadLettersSchema, ReplayedSchema, SystemHealthSchema } from "./health.dto.js";
import { HealthService } from "./health.service.js";
import { StaffAuditInterceptor } from "./staff-audit.interceptor.js";
import { PlatformGuard, StaffRoles } from "./staff.guard.js";

/** System health (A-4): super admins and engineers. */
@ApiTags("platform")
@Controller("platform/health")
@NoTenant()
@UseGuards(PlatformGuard)
@UseInterceptors(StaffAuditInterceptor)
@StaffRoles("super_admin", "engineer")
export class HealthController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  @Get()
  @ApiJson(200, "SystemHealth", SystemHealthSchema, "Jobs, events, circuits, drift, database and process, across stores; the same numbers as /metrics")
  @ApiProblems(403)
  overview() {
    return this.health.overview();
  }

  @Get("dead-letters")
  @ApiQueryZod(DeadLettersQuerySchema)
  @ApiJson(200, "PlatformDeadLetters", PlatformDeadLettersSchema, "Dead-lettered engine jobs across stores, newest first")
  @ApiProblems(403, 422)
  deadLetters(@Query(new ZodPipe(DeadLettersQuerySchema)) q: z.output<typeof DeadLettersQuerySchema>) {
    return this.health.deadLetters(q);
  }

  @Post("dead-letters/:id/replay")
  @HttpCode(200)
  @ApiJson(200, "PlatformReplayed", ReplayedSchema, "Queued again in its store; written to the store's audit log")
  @ApiProblems(403, 404)
  replay(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.health.replay(auth, id);
  }
}

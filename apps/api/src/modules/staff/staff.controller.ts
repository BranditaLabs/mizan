import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards, UseInterceptors } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { z } from "zod";
import { Auth, NoTenant } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { ApiJson, ApiJsonBody, ApiProblems, ApiQueryZod } from "../../platform/http/api-schema.js";
import { ZodPipe } from "../../platform/http/zod.pipe.js";
import { AddStaffSchema, StaffListSchema, StaffMeSchema, StaffSchema, TrailQuerySchema, TrailSchema, UpdateStaffSchema } from "./staff.dto.js";
import { StaffAuditInterceptor } from "./staff-audit.interceptor.js";
import { PlatformGuard, StaffRoles } from "./staff.guard.js";
import { StaffService } from "./staff.service.js";

/**
 * The back office (A-1): Mizan staff only. No store header (@NoTenant): staff act across stores
 * through the back office's own role; every call is a line in the staff trail.
 */
@ApiTags("platform")
@Controller("platform")
@NoTenant()
@UseGuards(PlatformGuard)
@UseInterceptors(StaffAuditInterceptor)
export class StaffController {
  constructor(@Inject(StaffService) private readonly staff: StaffService) {}

  @Get("me")
  @ApiJson(200, "StaffMe", StaffMeSchema, "The caller as Mizan staff (the first super admin is created from PLATFORM_BOOTSTRAP_EMAILS)")
  @ApiProblems(403)
  me(@Auth() auth: AuthContext) {
    return { id: auth.staff!.id, role: auth.staff!.role, email: auth.user.email };
  }

  @Get("staff")
  @StaffRoles("super_admin")
  @ApiJson(200, "StaffList", StaffListSchema, "Everyone on the staff")
  @ApiProblems(403)
  list() {
    return this.staff.list().then((data) => ({ data }));
  }

  @Post("staff")
  @StaffRoles("super_admin")
  @ApiJsonBody("AddStaff", AddStaffSchema)
  @ApiJson(201, "Staff", StaffSchema, "Added (they must have signed in to Mizan once)")
  @ApiProblems(403, 404, 409, 422)
  add(@Auth() auth: AuthContext, @Body(new ZodPipe(AddStaffSchema)) body: z.output<typeof AddStaffSchema>) {
    return this.staff.add(auth, body);
  }

  @Patch("staff/:id")
  @StaffRoles("super_admin")
  @ApiJsonBody("UpdateStaff", UpdateStaffSchema)
  @ApiJson(200, "Staff", StaffSchema, "Role or status changed; there is always an active super admin")
  @ApiProblems(403, 404, 409, 422)
  update(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string, @Body(new ZodPipe(UpdateStaffSchema)) body: z.output<typeof UpdateStaffSchema>) {
    return this.staff.update(auth, id, body);
  }

  @Get("audit")
  @StaffRoles("super_admin", "engineer")
  @ApiQueryZod(TrailQuerySchema)
  @ApiJson(200, "StaffTrail", TrailSchema, "The staff trail, newest first: every back-office call, refusals included")
  @ApiProblems(403, 422)
  trail(@Query(new ZodPipe(TrailQuerySchema)) q: z.output<typeof TrailQuerySchema>) {
    return this.staff.trail(q.limit, q.before);
  }
}

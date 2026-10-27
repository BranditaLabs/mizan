import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query, UseGuards, UseInterceptors } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { z } from "zod";
import { Auth, NoTenant } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { ApiJson, ApiJsonBody, ApiProblems, ApiQueryZod } from "../../platform/http/api-schema.js";
import { ZodPipe } from "../../platform/http/zod.pipe.js";
import { StaffAuditInterceptor } from "./staff-audit.interceptor.js";
import { PlatformGuard, StaffRoles } from "./staff.guard.js";
import { DisableUserSchema, UserDetailSchema, UsersPageSchema, UsersQuerySchema } from "./users.dto.js";
import { UsersService } from "./users.service.js";

/** Mizan users in the back office (A-5): support and super admins find people; super admins stop or allow sign-in. */
@ApiTags("platform")
@Controller("platform/users")
@NoTenant()
@UseGuards(PlatformGuard)
@UseInterceptors(StaffAuditInterceptor)
export class UsersController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  @Get()
  @StaffRoles("super_admin", "support", "engineer")
  @ApiQueryZod(UsersQuerySchema)
  @ApiJson(200, "PlatformUsers", UsersPageSchema, "Find people by email, phone, name or id; newest first")
  @ApiProblems(403, 422)
  search(@Query(new ZodPipe(UsersQuerySchema)) q: z.output<typeof UsersQuerySchema>) {
    return this.users.search(q);
  }

  @Get(":id")
  @StaffRoles("super_admin", "support", "engineer")
  @ApiJson(200, "PlatformUser", UserDetailSchema, "One person and the stores they belong to")
  @ApiProblems(403, 404)
  detail(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.users.detail(id);
  }

  @Post(":id/disable")
  @HttpCode(200)
  @StaffRoles("super_admin")
  @ApiJsonBody("DisableUser", DisableUserSchema)
  @ApiJson(200, "PlatformUser", UserDetailSchema, "Every request they make is refused (403 user_disabled); written to their stores' audit logs. Already disabled: unchanged")
  @ApiProblems(403, 404, 409, 422)
  disable(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string, @Body(new ZodPipe(DisableUserSchema)) body: z.output<typeof DisableUserSchema>) {
    return this.users.disable(auth, id, body.reason);
  }

  @Post(":id/enable")
  @HttpCode(200)
  @StaffRoles("super_admin")
  @ApiJson(200, "PlatformUser", UserDetailSchema, "They can sign in again; written to their stores' audit logs")
  @ApiProblems(403, 404)
  enable(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.users.enable(auth, id);
  }
}

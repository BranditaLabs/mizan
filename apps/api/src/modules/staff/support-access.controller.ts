import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, UseGuards, UseInterceptors } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { z } from "zod";
import { Auth, NoSupport, NoTenant, Roles } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { ApiJson, ApiJsonBody, ApiProblems } from "../../platform/http/api-schema.js";
import { ZodPipe } from "../../platform/http/zod.pipe.js";
import { StaffAuditInterceptor } from "./staff-audit.interceptor.js";
import { PlatformGuard, StaffRoles } from "./staff.guard.js";
import { EndedSchema, GrantSchema, GrantsSchema, OpenAccessSchema, StoreGrantsSchema } from "./support-access.dto.js";
import { SupportAccessService } from "./support-access.service.js";

/** Staff side of support access (A-3). Finance never needs a store's data, so it cannot open access. */
@ApiTags("platform")
@Controller("platform")
@NoTenant()
@UseGuards(PlatformGuard)
@UseInterceptors(StaffAuditInterceptor)
export class StaffSupportAccessController {
  constructor(@Inject(SupportAccessService) private readonly access: SupportAccessService) {}

  @Post("stores/:storeId/access")
  @StaffRoles("super_admin", "support", "engineer")
  @ApiJsonBody("OpenSupportAccess", OpenAccessSchema)
  @ApiJson(201, "SupportGrant", GrantSchema, "Access to the store's own routes (send its id as X-Tenant-Id) until expiresAt; the store sees it and may end it")
  @ApiProblems(403, 404, 409, 422)
  open(@Auth() auth: AuthContext, @Param("storeId", new ParseUUIDPipe()) storeId: string, @Body(new ZodPipe(OpenAccessSchema)) body: z.output<typeof OpenAccessSchema>) {
    return this.access.open(auth, storeId, body);
  }

  @Post("stores/:storeId/access/end")
  @HttpCode(200)
  @ApiJson(200, "SupportAccessEnded", EndedSchema, "Your access to this store ends now")
  @ApiProblems(403, 404)
  end(@Auth() auth: AuthContext, @Param("storeId", new ParseUUIDPipe()) storeId: string) {
    return this.access.endMine(auth, storeId);
  }

  @Get("access")
  @ApiJson(200, "SupportGrants", GrantsSchema, "Your open support access, soonest to end first")
  @ApiProblems(403)
  mine(@Auth() auth: AuthContext) {
    return this.access.mine(auth);
  }
}

/** Store side (A-3): who from Mizan support is in the store right now, and ending it early. */
@ApiTags("platform")
@Controller("support-access")
export class StoreSupportAccessController {
  constructor(@Inject(SupportAccessService) private readonly access: SupportAccessService) {}

  @Get()
  @ApiJson(200, "StoreSupportAccess", StoreGrantsSchema, "Mizan support with open access to this store (for the banner); history is in the audit log")
  list(@Auth() auth: AuthContext) {
    return this.access.forStore(auth);
  }

  @Post(":id/end")
  @HttpCode(200)
  @Roles("owner", "admin")
  @NoSupport()
  @ApiJson(200, "SupportAccessEnded", EndedSchema, "Ends Mizan support's access now (no-op when it already ended)")
  @ApiProblems(403, 404)
  end(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.access.endForStore(auth, id);
  }
}

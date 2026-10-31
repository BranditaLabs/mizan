import { Body, Controller, Delete, Get, Header, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Req, Res, UseGuards, UseInterceptors } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { z } from "zod";
import { Auth, NoTenant, Public } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { ApiJson, ApiJsonBody, ApiNoContent, ApiProblems } from "../../platform/http/api-schema.js";
import type { HttpReply as Response, HttpRequest as Request } from "../../platform/http/http.types.js";
import { NoIdempotency } from "../../platform/http/idempotency.interceptor.js";
import { RateLimiter } from "../../platform/http/rate-limit.js";
import { ZodPipe } from "../../platform/http/zod.pipe.js";
import { StaffAuditInterceptor } from "./staff-audit.interceptor.js";
import { PlatformGuard, StaffRoles } from "./staff.guard.js";
import { RemoveSsoDomainSchema, SetSsoDomainSchema, SsoDomainParamSchema, SsoDomainSchema, SsoDomainsSchema, SsoLookupSchema, SsoProviderSchema } from "./sso.dto.js";
import { SsoService } from "./sso.service.js";

/** The sign-in screen asks whether a work email signs in through its company (A-9). No sign-in; rate-limited per IP. */
@ApiTags("auth")
@Controller("public/sso")
@Public()
export class PublicSsoController {
  constructor(@Inject(SsoService) private readonly sso: SsoService, @Inject(RateLimiter) private readonly limits: RateLimiter) {}

  @Post()
  @HttpCode(200)
  @NoIdempotency()
  @Header("Cache-Control", "no-store")
  @ApiJsonBody("SsoLookup", SsoLookupSchema)
  @ApiJson(200, "SsoProvider", SsoProviderSchema, "The company's identity provider for this email's domain")
  @ApiProblems(404, 422, 429)
  lookup(@Body(new ZodPipe(SsoLookupSchema)) body: z.output<typeof SsoLookupSchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.limits.checkIp(req.ip, res);
    return this.sso.lookup(body.email);
  }
}

/** A store's company sign-in in the back office (A-9): every staff member can look; super admins change it. */
@ApiTags("platform")
@Controller("platform/stores/:storeId/sso")
@NoTenant()
@UseGuards(PlatformGuard)
@UseInterceptors(StaffAuditInterceptor)
export class StoreSsoController {
  constructor(@Inject(SsoService) private readonly sso: SsoService) {}

  @Get()
  @ApiJson(200, "SsoDomains", SsoDomainsSchema, "The store's email domains that sign in through its identity provider")
  @ApiProblems(403, 404)
  list(@Param("storeId", new ParseUUIDPipe()) storeId: string) {
    return this.sso.list(storeId);
  }

  @Put(":domain")
  @StaffRoles("super_admin")
  @ApiJsonBody("SetSsoDomain", SetSsoDomainSchema)
  @ApiJson(200, "SsoDomain", SsoDomainSchema, "Route a verified domain to the store's provider (create the provider in Identity Platform first). Written to the store's audit log.")
  @ApiProblems(403, 404, 409, 422)
  set(@Auth() auth: AuthContext, @Param("storeId", new ParseUUIDPipe()) storeId: string, @Param("domain", new ZodPipe(SsoDomainParamSchema)) domain: string,
    @Body(new ZodPipe(SetSsoDomainSchema)) body: z.output<typeof SetSsoDomainSchema>) {
    return this.sso.set(auth, storeId, domain, body);
  }

  @Delete(":domain")
  @HttpCode(204)
  @StaffRoles("super_admin")
  @ApiJsonBody("RemoveSsoDomain", RemoveSsoDomainSchema)
  @ApiNoContent("Removed: people at this domain sign in with email, phone or Google again. Written to the store's audit log.")
  @ApiProblems(403, 404, 422)
  async remove(@Auth() auth: AuthContext, @Param("storeId", new ParseUUIDPipe()) storeId: string, @Param("domain", new ZodPipe(SsoDomainParamSchema)) domain: string,
    @Body(new ZodPipe(RemoveSsoDomainSchema)) body: z.output<typeof RemoveSsoDomainSchema>) {
    await this.sso.remove(auth, storeId, domain, body.reason);
  }
}

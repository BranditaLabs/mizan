import { Body, Controller, Get, HttpCode, Inject, Post } from "@nestjs/common";
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { Auth, NoTenant } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { ZodPipe } from "../../platform/http/zod.pipe.js";
import { CreateTenantSchema, type CreateTenantBody, type TenantView } from "./tenants.dto.js";
import { TenantsService } from "./tenants.service.js";

@ApiTags("platform")
@Controller()
export class TenantsController {
  constructor(@Inject(TenantsService) private readonly tenants: TenantsService) {}

  /** Signup: create a store; the caller becomes its owner. */
  @Post("tenants")
  @NoTenant()
  @HttpCode(201)
  @ApiCreatedResponse({ description: "The new store, with the caller as owner." })
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(CreateTenantSchema)) body: CreateTenantBody): Promise<TenantView> {
    return this.tenants.create(auth.user.id, body, auth.ip);
  }

  /** The current store (X-Tenant-Id). */
  @Get("tenant")
  @ApiOkResponse({ description: "Store settings." })
  current(@Auth() auth: AuthContext): Promise<TenantView> {
    return this.tenants.get(auth.tenant!.id, auth.tenant!.role);
  }
}

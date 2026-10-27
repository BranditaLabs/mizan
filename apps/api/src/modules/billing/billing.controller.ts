import { Controller, Get, Inject, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Auth, Roles } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { ApiJson, ApiQueryZod } from "../../platform/http/api-schema.js";
import { ZodPipe } from "../../platform/http/zod.pipe.js";
import { UsageQuerySchema, UsageSchema } from "./usage.dto.js";
import { UsageService } from "./usage.service.js";

/** Billing (E12): the store's usage against its plan (E12-3). */
@ApiTags("billing")
@Controller("usage")
export class BillingController {
  constructor(@Inject(UsageService) private readonly usage: UsageService) {}

  @Get()
  @Roles("owner", "admin", "finance")
  @ApiQueryZod(UsageQuerySchema)
  @ApiJson(200, "Usage", UsageSchema, "A month's orders, messages and AI offers, the stores and users counted, the plan's limits, and the last six months")
  get(@Auth() auth: AuthContext, @Query(new ZodPipe(UsageQuerySchema)) q: { month?: string }) {
    return this.usage.get(auth, q.month);
  }
}

import { Controller, Get, Inject, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Auth, Roles } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { ApiJson, ApiProblems, ApiQueryZod } from "../../platform/http/api-schema.js";
import { ZodPipe } from "../../platform/http/zod.pipe.js";
import { RoasQuerySchema, RoasSchema, type RoasQuery } from "./attribution.dto.js";
import { AttributionService } from "./attribution.service.js";

/** M7 ad-to-cash attribution: True ROAS (M7-1). */
@ApiTags("attribution")
@Controller("attribution")
export class AttributionController {
  constructor(@Inject(AttributionService) private readonly attribution: AttributionService) {}

  @Get("roas")
  @Roles("owner", "admin", "ops_manager", "finance")
  @ApiQueryZod(RoasQuerySchema)
  @ApiJson(200, "Roas", RoasSchema, "Ad spend against what the period's orders really brought: true, reported and projected ROAS, cost per delivered order, by day and platform")
  @ApiProblems(422)
  roas(@Auth() auth: AuthContext, @Query(new ZodPipe(RoasQuerySchema)) q: RoasQuery) {
    return this.attribution.roas(auth, q);
  }
}

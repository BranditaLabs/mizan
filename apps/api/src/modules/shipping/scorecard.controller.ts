import { Controller, Get, Inject, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Auth, Roles } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { ApiJson, ApiProblems, ApiQueryZod } from "../../platform/http/api-schema.js";
import { ZodPipe } from "../../platform/http/zod.pipe.js";
import { ScorecardQuerySchema, ScorecardSchema, type ScorecardQuery } from "./scorecard.dto.js";
import { ScorecardService } from "./scorecard.service.js";

/** M3 courier scorecard (E7-4). */
@ApiTags("shipping")
@Controller("couriers")
export class ScorecardController {
  constructor(@Inject(ScorecardService) private readonly scorecard: ScorecardService) {}

  @Get("scorecard")
  @Roles("owner", "admin", "ops_manager", "finance")
  @ApiQueryZod(ScorecardQuerySchema)
  @ApiJson(200, "CourierScorecard", ScorecardSchema, "Per courier and zone: delivered, returned, still out, delivered rate (the metric layer's formula), days to deliver")
  @ApiProblems(422)
  get(@Auth() auth: AuthContext, @Query(new ZodPipe(ScorecardQuerySchema)) q: ScorecardQuery) {
    return this.scorecard.get(auth, q);
  }
}

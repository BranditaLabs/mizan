import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { z } from "zod";
import { Auth, Roles } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { ApiJson, ApiJsonBody, ApiNoContent, ApiProblems, ApiQueryZod } from "../../platform/http/api-schema.js";
import { ZodPipe } from "../../platform/http/zod.pipe.js";
import { CostRuleListSchema, CostRuleQuerySchema, CostRuleSchema, CreateCostRuleSchema, type CreateCostRule } from "./cost-rules.dto.js";
import { CostRulesService } from "./cost-rules.service.js";
import { FxParamsSchema, FxQuerySchema, FxRateSchema, FxRatesSchema, SetFxRateSchema } from "./fx.dto.js";
import { FxService } from "./fx/fx.service.js";

/** M5 profit inputs (E9-1): cost rules and exchange rates. Owner, admin and finance change them; ops managers read. */
@ApiTags("profit")
@Controller()
export class ProfitController {
  constructor(@Inject(CostRulesService) private readonly rules: CostRulesService, @Inject(FxService) private readonly fx: FxService) {}

  @Get("cost-rules")
  @Roles("owner", "admin", "finance", "ops_manager")
  @ApiQueryZod(CostRuleQuerySchema)
  @ApiJson(200, "CostRuleList", CostRuleListSchema, "Rules that apply on a day (default today), or every version")
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(CostRuleQuerySchema)) q: z.output<typeof CostRuleQuerySchema>) {
    return this.rules.list(auth.tenant!.id, q);
  }

  @Post("cost-rules")
  @Roles("owner", "admin", "finance")
  @HttpCode(201)
  @ApiJsonBody("CreateCostRule", CreateCostRuleSchema)
  @ApiJson(201, "CostRule", CostRuleSchema, "The new version; the previous one for the same kind and scope now ends the day before")
  @ApiProblems(409)
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(CreateCostRuleSchema)) body: CreateCostRule) {
    return this.rules.create(auth, body);
  }

  @Delete("cost-rules/:id")
  @Roles("owner", "admin", "finance")
  @HttpCode(204)
  @ApiNoContent("Ended: applies through today, not after (a version that has not started is withdrawn)")
  @ApiProblems(404)
  async end(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string): Promise<void> {
    await this.rules.end(auth, id);
  }

  @Get("fx-rates")
  @Roles("owner", "admin", "finance", "ops_manager")
  @ApiQueryZod(FxQuerySchema)
  @ApiJson(200, "FxRates", FxRatesSchema, "The store's base currency against USD and the currencies its orders used in the last 90 days")
  rates(@Auth() auth: AuthContext, @Query(new ZodPipe(FxQuerySchema)) q: z.output<typeof FxQuerySchema>) {
    return this.fx.list(auth.tenant!.id, q.day);
  }

  @Put("fx-rates/:day/:quote")
  @Roles("owner", "admin", "finance")
  @ApiJsonBody("SetFxRate", SetFxRateSchema)
  @ApiJson(200, "FxRate", FxRateSchema, "The store's own rate for that day; it wins over the feed")
  setRate(
    @Auth() auth: AuthContext, @Param("day", new ZodPipe(FxParamsSchema.shape.day)) day: string, @Param("quote", new ZodPipe(FxParamsSchema.shape.quote)) quote: string,
    @Body(new ZodPipe(SetFxRateSchema)) body: z.output<typeof SetFxRateSchema>,
  ) {
    return this.fx.setOverride(auth, day, quote, body.rate);
  }
}

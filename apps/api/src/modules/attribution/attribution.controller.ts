import { randomUUID } from "node:crypto";
import { Controller, Get, HttpCode, Inject, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Auth, Can } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { ApiJson, ApiProblems, ApiQueryZod } from "../../platform/http/api-schema.js";
import { ZodPipe } from "../../platform/http/zod.pipe.js";
import { BackfillSourcesSchema, CampaignQuerySchema, CampaignResultsSchema, OrderSourcesSchema, RoasQuerySchema, RoasSchema, type CampaignQuery, type RoasQuery } from "./attribution.dto.js";
import { AttributionService } from "./attribution.service.js";

/** M7 ad-to-cash attribution: True ROAS (M7-1), where orders came from (M7-2), campaign results (M7-3). */
@ApiTags("attribution")
@Controller("attribution")
export class AttributionController {
  constructor(@Inject(AttributionService) private readonly attribution: AttributionService) {}

  @Get("roas")
  @Can("ads.read")
  @ApiQueryZod(RoasQuerySchema)
  @ApiJson(200, "Roas", RoasSchema, "Ad spend against what the period's orders really brought: true, reported and projected ROAS, cost per delivered order, by day and platform")
  @ApiProblems(422)
  roas(@Auth() auth: AuthContext, @Query(new ZodPipe(RoasQuerySchema)) q: RoasQuery) {
    return this.attribution.roas(auth, q);
  }

  @Get("sources")
  @Can("ads.read")
  @ApiQueryZod(RoasQuerySchema)
  @ApiJson(200, "OrderSources", OrderSourcesSchema, "The period's orders by source platform and UTM campaign: delivery, real money, profit, and true ROAS where spend is recorded")
  @ApiProblems(422)
  sources(@Auth() auth: AuthContext, @Query(new ZodPipe(RoasQuerySchema)) q: RoasQuery) {
    return this.attribution.sources(auth, q);
  }

  @Get("campaigns")
  @Can("ads.read")
  @ApiQueryZod(CampaignQuerySchema)
  @ApiJson(200, "CampaignResults", CampaignResultsSchema, "Per campaign, ad set or ad: spend against what its orders really brought (true ROAS, cost per delivered order, delivered rate, fake-order share); untagged orders and unassigned spend always shown")
  @ApiProblems(422)
  campaigns(@Auth() auth: AuthContext, @Query(new ZodPipe(CampaignQuerySchema)) q: CampaignQuery) {
    return this.attribution.campaigns(auth, q);
  }

  @Post("sources/backfill")
  @HttpCode(202)
  @Can("ads.backfill")
  @ApiJson(202, "BackfillSources", BackfillSourcesSchema, "Read the stores' recent orders again so each one's source is captured (Shopify: the last 60 days)")
  backfill(@Auth() auth: AuthContext) {
    return this.attribution.backfillSources(auth, randomUUID());
  }
}

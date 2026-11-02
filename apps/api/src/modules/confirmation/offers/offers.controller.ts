import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { z } from "zod";
import { Auth, Roles } from "../../../platform/auth/decorators.js";
import type { AuthContext } from "../../../platform/auth/auth.types.js";
import { ApiJson, ApiJsonBody, ApiNoContent, ApiProblems, ApiQueryZod } from "../../../platform/http/api-schema.js";
import { ZodPipe } from "../../../platform/http/zod.pipe.js";
import {
  IdSchema, OfferDecidedSchema, OfferDecisionSchema, OfferProductsQuerySchema, OfferProductsSchema, OfferRuleCreateSchema, OfferRuleListSchema, OfferRuleUpdateSchema,
  OfferSettingsSchema, OfferSummaryQuerySchema, OfferSummarySchema,
} from "./offers.dto.js";
import type { OfferSettings } from "./offer.settings.js";
import { OffersService } from "./offers.service.js";

/** Upsell and cross-sell at confirmation (M2, E6-11): settings, the owner's rules, results, and the team's answer on a call. */
@ApiTags("offers")
@Controller()
export class OffersController {
  constructor(@Inject(OffersService) private readonly offers: OffersService) {}

  @Get("settings/offers")
  @Roles("owner", "admin", "ops_manager")
  @ApiJson(200, "OfferSettings", OfferSettingsSchema, "Offers on or off, rules or recommendations, discount caps, where they show")
  settings(@Auth() auth: AuthContext) {
    return this.offers.getSettings(auth.tenant!.id);
  }

  @Put("settings/offers")
  @Roles("owner", "admin", "ops_manager")
  @ApiJsonBody("OfferSettings", OfferSettingsSchema)
  @ApiJson(200, "OfferSettings", OfferSettingsSchema, "Saved; applies to confirmations that start from now on; audited")
  saveSettings(@Auth() auth: AuthContext, @Body(new ZodPipe(OfferSettingsSchema)) body: OfferSettings) {
    return this.offers.putSettings(auth, body);
  }

  @Get("offer-rules")
  @Roles("owner", "admin", "ops_manager")
  @ApiJson(200, "OfferRuleList", OfferRuleListSchema, "The owner's offer rules, active first")
  rules(@Auth() auth: AuthContext) {
    return this.offers.rules(auth.tenant!.id);
  }

  @Post("offer-rules")
  @Roles("owner", "admin", "ops_manager")
  @ApiJsonBody("OfferRuleCreate", OfferRuleCreateSchema)
  @ApiJson(201, "Id", IdSchema, "Rule added; audited")
  @ApiProblems(404, 422)
  addRule(@Auth() auth: AuthContext, @Body(new ZodPipe(OfferRuleCreateSchema)) body: z.output<typeof OfferRuleCreateSchema>) {
    return this.offers.addRule(auth, body);
  }

  @Patch("offer-rules/:id")
  @Roles("owner", "admin", "ops_manager")
  @HttpCode(204)
  @ApiJsonBody("OfferRuleUpdate", OfferRuleUpdateSchema)
  @ApiNoContent("Stopped or restarted; audited")
  @ApiProblems(404)
  setRule(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string, @Body(new ZodPipe(OfferRuleUpdateSchema)) body: z.output<typeof OfferRuleUpdateSchema>) {
    return this.offers.setRuleActive(auth, id, body.active);
  }

  @Get("offer-products")
  @Roles("owner", "admin", "ops_manager")
  @ApiQueryZod(OfferProductsQuerySchema)
  @ApiJson(200, "OfferProducts", OfferProductsSchema, "Active products to pick in a rule (100 at most)")
  products(@Auth() auth: AuthContext, @Query(new ZodPipe(OfferProductsQuerySchema)) q: z.output<typeof OfferProductsQuerySchema>) {
    return this.offers.searchProducts(auth.tenant!.id, q.q);
  }

  @Get("offers/summary")
  @Roles("owner", "admin", "ops_manager", "finance")
  @ApiQueryZod(OfferSummaryQuerySchema)
  @ApiJson(200, "OfferSummary", OfferSummarySchema, "Offers made and taken, and what they added")
  summary(@Auth() auth: AuthContext, @Query(new ZodPipe(OfferSummaryQuerySchema)) q: z.output<typeof OfferSummaryQuerySchema>) {
    return this.offers.summary(auth.tenant!.id, q.days);
  }

  @Post("orders/:id/offer")
  @Roles("owner", "admin", "ops_manager", "agent")
  @HttpCode(200)
  @ApiJsonBody("OfferDecision", OfferDecisionSchema)
  @ApiJson(200, "OfferDecided", OfferDecidedSchema, "The customer's answer to the offer on the team's call; expired when too late; audited")
  @ApiProblems(404)
  decide(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string, @Body(new ZodPipe(OfferDecisionSchema)) body: z.output<typeof OfferDecisionSchema>) {
    return this.offers.decideByTeam(auth, id, body.decision);
  }
}

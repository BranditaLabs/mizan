import { Body, Controller, Get, Inject, Put, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { z } from "zod";
import { Auth, Roles } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { ApiJson, ApiJsonBody, ApiProblems, ApiQueryZod } from "../../platform/http/api-schema.js";
import { ZodPipe } from "../../platform/http/zod.pipe.js";
import { CostsUpdatedSchema, SetCostsSchema, VariantCostPageSchema, VariantCostQuerySchema } from "./catalog.dto.js";
import { CatalogService } from "./catalog.service.js";

/** Product costs for profit (M4/M5). Products come from the store; their costs are entered here. */
@ApiTags("catalog")
@Controller("products/variants")
@Roles("owner", "admin", "ops_manager", "finance")
export class CatalogController {
  constructor(@Inject(CatalogService) private readonly catalog: CatalogService) {}

  @Get("costs")
  @ApiQueryZod(VariantCostQuerySchema)
  @ApiJson(200, "VariantCostPage", VariantCostPageSchema, "Variants with their price and cost, oldest first")
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(VariantCostQuerySchema)) q: z.output<typeof VariantCostQuerySchema>) {
    return this.catalog.costs(auth.tenant!.id, q);
  }

  @Put("costs")
  @ApiJsonBody("SetCosts", SetCostsSchema)
  @ApiJson(200, "CostsUpdated", CostsUpdatedSchema, "Saved; how many variants still have no cost")
  @ApiProblems(404)
  set(@Auth() auth: AuthContext, @Body(new ZodPipe(SetCostsSchema)) body: z.infer<typeof SetCostsSchema>) {
    return this.catalog.setCosts(auth, body);
  }
}

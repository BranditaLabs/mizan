import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { z } from "zod";
import { Auth, Roles } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { ApiJson, ApiJsonBody, ApiProblems, ApiQueryZod } from "../../platform/http/api-schema.js";
import { ZodPipe } from "../../platform/http/zod.pipe.js";
import { MovementsRecordedSchema, RecordMovementsSchema, StockHistorySchema, StockPageSchema, StockQuerySchema, ThresholdSchema, ThresholdSetSchema } from "./stock.dto.js";
import { InventorySettingsSchema, type InventorySettings } from "./stock.settings.js";
import { StockService } from "./stock.service.js";

/** Stock in the main warehouse (M4, E8-2). Warehouse staff count and receive; finance reads. */
@ApiTags("stock")
@Controller("stock")
export class StockController {
  constructor(@Inject(StockService) private readonly stock: StockService) {}

  @Get()
  @Roles("owner", "admin", "ops_manager", "warehouse", "finance")
  @ApiQueryZod(StockQuerySchema)
  @ApiJson(200, "StockPage", StockPageSchema, "Variants by SKU with on hand, reserved and available")
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(StockQuerySchema)) q: z.output<typeof StockQuerySchema>) {
    return this.stock.list(auth.tenant!.id, q);
  }

  @Post("movements")
  @HttpCode(200)
  @Roles("owner", "admin", "ops_manager", "warehouse")
  @ApiJsonBody("RecordMovements", RecordMovementsSchema)
  @ApiJson(200, "MovementsRecorded", MovementsRecordedSchema, "All applied, or none (422 below_reserved naming each item)")
  @ApiProblems(404, 422)
  record(@Auth() auth: AuthContext, @Body(new ZodPipe(RecordMovementsSchema)) body: z.infer<typeof RecordMovementsSchema>) {
    return this.stock.record(auth, body);
  }

  @Get(":variantId/movements")
  @Roles("owner", "admin", "ops_manager", "warehouse", "finance")
  @ApiJson(200, "StockHistory", StockHistorySchema, "The last 100 movements, newest first")
  @ApiProblems(404)
  history(@Auth() auth: AuthContext, @Param("variantId", new ParseUUIDPipe()) variantId: string) {
    return this.stock.history(auth.tenant!.id, variantId);
  }

  @Patch(":variantId")
  @Roles("owner", "admin", "ops_manager", "warehouse")
  @ApiJsonBody("StockThreshold", ThresholdSchema)
  @ApiJson(200, "StockThresholdSet", ThresholdSetSchema, "Saved; stock.low fires when available falls to it or under")
  @ApiProblems(404, 409)
  threshold(@Auth() auth: AuthContext, @Param("variantId", new ParseUUIDPipe()) variantId: string, @Body(new ZodPipe(ThresholdSchema)) body: z.infer<typeof ThresholdSchema>) {
    return this.stock.setThreshold(auth, variantId, body.lowStockAt);
  }
}

/** Settings → Inventory (E8-5): whether the store gets Mizan's count. */
@ApiTags("stock")
@Controller("settings/inventory")
@Roles("owner", "admin", "ops_manager")
export class InventorySettingsController {
  constructor(@Inject(StockService) private readonly stock: StockService) {}

  @Get()
  @ApiJson(200, "InventorySettings", InventorySettingsSchema, "How stock is shared with the store")
  get(@Auth() auth: AuthContext) {
    return this.stock.getSettings(auth.tenant!.id);
  }

  @Put()
  @ApiJsonBody("InventorySettings", InventorySettingsSchema)
  @ApiJson(200, "InventorySettings", InventorySettingsSchema, "Saved; turning it on sends every counted item's number to the store")
  put(@Auth() auth: AuthContext, @Body(new ZodPipe(InventorySettingsSchema)) body: InventorySettings) {
    return this.stock.putSettings(auth, body);
  }
}

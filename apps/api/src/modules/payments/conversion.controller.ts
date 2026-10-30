import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Auth, Roles } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { ApiJson, ApiJsonBody, ApiProblems } from "../../platform/http/api-schema.js";
import { ZodPipe } from "../../platform/http/zod.pipe.js";
import { ConversionSettingsSchema, NewConversionSchema, OrderConversionSchema, type ConversionSettings, type NewConversion } from "./conversion.dto.js";
import { ConversionService } from "./conversion.service.js";

/** E14-3: convert a COD order to prepaid (or a deposit) before shipping. */
@ApiTags("payments")
@Controller("orders/:id/conversion")
@Roles("owner", "admin", "ops_manager", "agent", "finance")
export class OrderConversionController {
  constructor(@Inject(ConversionService) private readonly conversions: ConversionService) {}

  @Get()
  @ApiJson(200, "OrderConversion", OrderConversionSchema, "Whether the order can be converted, what is owed, the latest offer and, while open, the message to send")
  @ApiProblems(404)
  get(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.conversions.get(auth.tenant!.id, id);
  }

  @Post()
  @HttpCode(201)
  @ApiJsonBody("NewConversion", NewConversionSchema)
  @ApiJson(201, "OrderConversion", OrderConversionSchema, "An offer to pay all (or a deposit) before shipping; emits payment.link_sent; audited. Paid when the ledger receives it")
  @ApiProblems(404, 409, 422)
  offer(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string, @Body(new ZodPipe(NewConversionSchema)) body: NewConversion) {
    return this.conversions.offer(auth, id, body);
  }

  @Post("cancel")
  @HttpCode(200)
  @ApiJson(200, "OrderConversion", OrderConversionSchema, "The open offer withdrawn; audited")
  @ApiProblems(404, 409)
  cancel(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.conversions.cancel(auth, id);
  }
}

/** Settings → Payments: where customers pay a conversion, the deposit share and how long an offer stays open. */
@ApiTags("payments")
@Controller("settings/conversion")
export class ConversionSettingsController {
  constructor(@Inject(ConversionService) private readonly conversions: ConversionService) {}

  @Get()
  @Roles("owner", "admin", "ops_manager", "finance")
  @ApiJson(200, "ConversionSettings", ConversionSettingsSchema, "Deposit share, offer time and the store's pay-to details per method")
  get(@Auth() auth: AuthContext) {
    return this.conversions.getSettings(auth.tenant!.id);
  }

  @Put()
  @Roles("owner", "admin", "finance")
  @ApiJsonBody("ConversionSettingsInput", ConversionSettingsSchema)
  @ApiJson(200, "ConversionSettings", ConversionSettingsSchema, "Saved; audited")
  put(@Auth() auth: AuthContext, @Body(new ZodPipe(ConversionSettingsSchema)) body: ConversionSettings) {
    return this.conversions.putSettings(auth, body);
  }
}

import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Auth, Roles } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { ApiJson, ApiJsonBody, ApiProblems } from "../../platform/http/api-schema.js";
import { ZodPipe } from "../../platform/http/zod.pipe.js";
import { ExchangeSchema, NewExchangeSchema, OrderExchangesSchema, type NewExchange } from "./exchanges.dto.js";
import { ExchangesService } from "./exchanges.service.js";

/** M6 exchanges (E10-2): a replacement order linked to the original both ways. */
@ApiTags("returns")
@Controller()
export class ExchangesController {
  constructor(@Inject(ExchangesService) private readonly exchanges: ExchangesService) {}

  @Post("exchanges")
  @Roles("owner", "admin", "ops_manager", "agent")
  @ApiJsonBody("NewExchange", NewExchangeSchema)
  @ApiJson(201, "Exchange", ExchangeSchema, "The replacement order (confirmed), the credit moved from the original, what the courier collects or the refund due; audited")
  @ApiProblems(404, 409, 422)
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(NewExchangeSchema)) body: NewExchange) {
    return this.exchanges.create(auth, body);
  }

  @Get("orders/:id/exchanges")
  @Roles("owner", "admin", "ops_manager", "finance", "agent", "warehouse")
  @ApiJson(200, "OrderExchanges", OrderExchangesSchema, "Exchanges made from this order, and the one it is the replacement of")
  @ApiProblems(404)
  forOrder(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.exchanges.forOrder(auth.tenant!.id, id);
  }
}

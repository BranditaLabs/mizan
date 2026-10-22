import { Controller, Get, Inject, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Auth, Roles } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { ApiJson, ApiQueryZod } from "../../platform/http/api-schema.js";
import { ZodPipe } from "../../platform/http/zod.pipe.js";
import { ListOrdersQuerySchema, OrderPageSchema, type ListOrdersQuery } from "./orders.dto.js";
import { OrdersService } from "./orders.service.js";

@ApiTags("orders")
@Controller("orders")
export class OrdersController {
  constructor(@Inject(OrdersService) private readonly orders: OrdersService) {}

  /** M1 list (E5-1): newest first, filters, search, cursor pages, counts per status. */
  @Get()
  @Roles("owner", "admin", "ops_manager", "finance", "agent", "warehouse")
  @ApiQueryZod(ListOrdersQuerySchema)
  @ApiJson(200, "OrderPage", OrderPageSchema, "Agents see orders assigned to them; warehouse sees confirmed and shipped orders")
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(ListOrdersQuerySchema)) q: ListOrdersQuery) {
    return this.orders.list(auth, q);
  }
}

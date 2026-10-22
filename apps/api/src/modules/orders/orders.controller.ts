import { Controller, Get, Header, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Auth, Roles } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { ApiJson, ApiProblems, ApiQueryZod } from "../../platform/http/api-schema.js";
import { NoIdempotency } from "../../platform/http/idempotency.interceptor.js";
import { ZodPipe } from "../../platform/http/zod.pipe.js";
import { ListOrdersQuerySchema, OrderDetailSchema, OrderPageSchema, RevealedCustomerSchema, type ListOrdersQuery } from "./orders.dto.js";
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

  /** M1 detail (E5-2): lines, money, payments, shipments, timeline; the customer stays masked. */
  @Get(":id")
  @Roles("owner", "admin", "ops_manager", "finance", "agent", "warehouse")
  @ApiJson(200, "OrderDetail", OrderDetailSchema, "One order; an order outside the caller's scope is not found")
  @ApiProblems(404)
  detail(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.orders.detail(auth, id);
  }

  /** The delivery contact in full: decrypted for this person only, every call in the audit log (customer.pii_viewed). */
  @Post(":id/reveal")
  @Roles("owner", "admin", "ops_manager", "agent", "warehouse")
  @HttpCode(200)
  @NoIdempotency() // never store the decrypted answer, never replay without an audit row
  @Header("Cache-Control", "no-store")
  @ApiJson(200, "RevealedCustomer", RevealedCustomerSchema, "Name, phone, address and map pin; recorded in the audit log")
  @ApiProblems(404, 410, 429)
  reveal(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.orders.reveal(auth, id);
  }
}

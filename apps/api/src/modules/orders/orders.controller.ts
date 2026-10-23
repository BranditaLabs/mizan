import { Body, Controller, Get, Header, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Auth, Roles } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { ApiJson, ApiJsonBody, ApiProblems, ApiQueryZod } from "../../platform/http/api-schema.js";
import { NoIdempotency } from "../../platform/http/idempotency.interceptor.js";
import { ZodPipe } from "../../platform/http/zod.pipe.js";
import { DuplicateResolvedSchema, ListOrdersQuerySchema, OrderDetailSchema, OrderPageSchema, ResolveDuplicateSchema, RevealedCustomerSchema, type ListOrdersQuery } from "./orders.dto.js";
import { DuplicatesService, OrderSettingsSchema, type OrderSettings } from "./duplicates.service.js";
import { OrdersService } from "./orders.service.js";

@ApiTags("orders")
@Controller("orders")
export class OrdersController {
  constructor(@Inject(OrdersService) private readonly orders: OrdersService, @Inject(DuplicatesService) private readonly duplicates: DuplicatesService) {}

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

  /** A likely duplicate (E5-3): keep both, or merge this one into the earlier order (cancelled here, tagged in the store). */
  @Post(":id/duplicate")
  @Roles("owner", "admin", "ops_manager", "agent")
  @HttpCode(200)
  @ApiJsonBody("ResolveDuplicate", ResolveDuplicateSchema)
  @ApiJson(200, "DuplicateResolved", DuplicateResolvedSchema, "The order's answer; one already answered keeps it")
  @ApiProblems(404, 409)
  resolveDuplicate(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string, @Body(new ZodPipe(ResolveDuplicateSchema)) body: { action: "keep" | "merge" }) {
    return this.duplicates.resolve(auth, id, body.action).then((r) => ({ status: r.status }));
  }
}

/** Settings → Orders (M1): the duplicate window. Owner, admin and ops manager. */
@ApiTags("orders")
@Controller("settings/orders")
export class OrderSettingsController {
  constructor(@Inject(DuplicatesService) private readonly duplicates: DuplicatesService) {}

  @Get()
  @Roles("owner", "admin", "ops_manager")
  @ApiJson(200, "OrderSettings", OrderSettingsSchema, "How orders are handled as they arrive")
  get(@Auth() auth: AuthContext) {
    return this.duplicates.getSettings(auth.tenant!.id);
  }

  @Put()
  @Roles("owner", "admin", "ops_manager")
  @ApiJsonBody("OrderSettings", OrderSettingsSchema)
  @ApiJson(200, "OrderSettings", OrderSettingsSchema, "Saved; applies to orders that arrive from now on")
  put(@Auth() auth: AuthContext, @Body(new ZodPipe(OrderSettingsSchema)) body: OrderSettings) {
    return this.duplicates.putSettings(auth, body);
  }
}

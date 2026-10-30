import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { Auth, Roles } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { ApiJson, ApiJsonBody, ApiProblems, ApiQueryZod } from "../../platform/http/api-schema.js";
import { ZodPipe } from "../../platform/http/zod.pipe.js";
import {
  NewPurchaseOrderSchema, NewReceiptSchema, NewSupplierSchema, PurchaseOrderListSchema, PurchaseOrderSchema, PurchaseOrdersQuerySchema,
  PurchasingSettingsSchema, SupplierListSchema, SupplierSchema, SuppliersQuerySchema, UpdateSupplierSchema,
  type NewPurchaseOrder, type NewReceipt, type NewSupplier, type PurchasingSettings, type UpdateSupplier,
} from "./purchasing.dto.js";
import { PurchasingService } from "./purchasing.service.js";


const SettingsViewSchema = z.object({ approveOver: z.string().describe("Decimal in the store's base currency"), currency: z.string() });

/** M16 suppliers (M16-1). */
@ApiTags("purchasing")
@Controller("suppliers")
export class SuppliersController {
  constructor(@Inject(PurchasingService) private readonly purchasing: PurchasingService) {}

  @Get()
  @Roles("owner", "admin", "ops_manager", "finance")
  @ApiQueryZod(SuppliersQuerySchema)
  @ApiJson(200, "SupplierList", SupplierListSchema, "Active (or archived) suppliers by name, with their open POs")
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(SuppliersQuerySchema)) q: z.output<typeof SuppliersQuerySchema>) {
    return this.purchasing.suppliers(auth.tenant!.id, q.archived);
  }

  @Post()
  @Roles("owner", "admin", "ops_manager")
  @ApiJsonBody("NewSupplier", NewSupplierSchema)
  @ApiJson(201, "Supplier", SupplierSchema, "Created; the name is unique among active suppliers; audited")
  @ApiProblems(409)
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(NewSupplierSchema)) body: NewSupplier) {
    return this.purchasing.createSupplier(auth, body);
  }

  @Patch(":id")
  @Roles("owner", "admin", "ops_manager")
  @ApiJsonBody("UpdateSupplier", UpdateSupplierSchema)
  @ApiJson(200, "Supplier", SupplierSchema, "Changed fields, or archived/restored; audited")
  @ApiProblems(404, 409)
  update(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string, @Body(new ZodPipe(UpdateSupplierSchema)) body: UpdateSupplier) {
    return this.purchasing.updateSupplier(auth, id, body);
  }
}

/** M16 purchase orders and receiving (M16-1). */
@ApiTags("purchasing")
@Controller("purchase-orders")
export class PurchaseOrdersController {
  constructor(@Inject(PurchasingService) private readonly purchasing: PurchasingService) {}

  @Get()
  @Roles("owner", "admin", "ops_manager", "finance", "warehouse")
  @ApiQueryZod(PurchaseOrdersQuerySchema)
  @ApiJson(200, "PurchaseOrderList", PurchaseOrderListSchema, "Newest first, with a count per status; open = what can still be received")
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(PurchaseOrdersQuerySchema)) q: z.output<typeof PurchaseOrdersQuerySchema>) {
    return this.purchasing.list(auth.tenant!.id, q);
  }

  @Post()
  @Roles("owner", "admin", "ops_manager")
  @ApiJsonBody("NewPurchaseOrder", NewPurchaseOrderSchema)
  @ApiJson(201, "PurchaseOrder", PurchaseOrderSchema, "A draft numbered PO-0001…, in the supplier's currency unless given; audited")
  @ApiProblems(404, 409, 422)
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(NewPurchaseOrderSchema)) body: NewPurchaseOrder) {
    return this.purchasing.create(auth, body);
  }

  @Get(":id")
  @Roles("owner", "admin", "ops_manager", "finance", "warehouse")
  @ApiJson(200, "PurchaseOrder", PurchaseOrderSchema, "Lines with what arrived, and each receipt with its locked FX rate")
  @ApiProblems(404)
  get(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.purchasing.get(auth.tenant!.id, id);
  }

  @Put(":id")
  @Roles("owner", "admin", "ops_manager")
  @ApiJsonBody("NewPurchaseOrder", NewPurchaseOrderSchema)
  @ApiJson(200, "PurchaseOrder", PurchaseOrderSchema, "A draft replaced as a whole; audited")
  @ApiProblems(404, 409, 422)
  update(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string, @Body(new ZodPipe(NewPurchaseOrderSchema)) body: NewPurchaseOrder) {
    return this.purchasing.update(auth, id, body);
  }

  @Post(":id/approve")
  @HttpCode(200)
  @Roles("owner", "admin", "ops_manager")
  @ApiJson(200, "PurchaseOrder", PurchaseOrderSchema, "Approved; above the store's threshold or in a foreign currency only by the owner or an admin (403 needs_owner); audited")
  @ApiProblems(403, 404, 409)
  approve(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.purchasing.approve(auth, id);
  }

  @Post(":id/send")
  @HttpCode(200)
  @Roles("owner", "admin", "ops_manager")
  @ApiJson(200, "PurchaseOrder", PurchaseOrderSchema, "Marked as sent to the supplier; repeating it changes nothing; audited")
  @ApiProblems(404, 409)
  send(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.purchasing.send(auth, id);
  }

  @Post(":id/cancel")
  @HttpCode(200)
  @Roles("owner", "admin", "ops_manager")
  @ApiJson(200, "PurchaseOrder", PurchaseOrderSchema, "Cancelled while nothing was received; audited")
  @ApiProblems(404, 409)
  cancel(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.purchasing.cancel(auth, id);
  }

  @Post(":id/receipts")
  @HttpCode(201)
  @Roles("owner", "admin", "ops_manager", "warehouse")
  @ApiJsonBody("NewReceipt", NewReceiptSchema)
  @ApiJson(201, "PurchaseOrder", PurchaseOrderSchema, "Good units into stock, damaged recorded, moving-average cost at the day's FX rate; more than ordered needs allowOver (409 over_receipt); audited")
  @ApiProblems(403, 404, 409, 422)
  receive(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string, @Body(new ZodPipe(NewReceiptSchema)) body: NewReceipt) {
    return this.purchasing.receiveWeb(auth, id, body);
  }
}

/** Settings → Purchasing (M16-1). */
@ApiTags("purchasing")
@Controller("settings/purchasing")
export class PurchasingSettingsController {
  constructor(@Inject(PurchasingService) private readonly purchasing: PurchasingService) {}

  @Get()
  @Roles("owner", "admin", "ops_manager", "finance")
  @ApiJson(200, "PurchasingSettings", SettingsViewSchema, "The approval threshold in the store's base currency")
  get(@Auth() auth: AuthContext) {
    return this.purchasing.getSettings(auth.tenant!.id);
  }

  @Put()
  @Roles("owner", "admin")
  @ApiJsonBody("PurchasingSettingsInput", PurchasingSettingsSchema)
  @ApiJson(200, "PurchasingSettings", SettingsViewSchema, "Saved; audited")
  @ApiProblems(422)
  put(@Auth() auth: AuthContext, @Body(new ZodPipe(PurchasingSettingsSchema)) body: PurchasingSettings) {
    return this.purchasing.putSettings(auth, body);
  }
}

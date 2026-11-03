import { Body, Controller, Delete, Get, Header, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { z } from "zod";
import { Auth, Roles } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { ApiJson, ApiJsonBody, ApiNoContent, ApiProblems, ApiQueryZod } from "../../platform/http/api-schema.js";
import { NoIdempotency } from "../../platform/http/idempotency.interceptor.js";
import { ZodPipe } from "../../platform/http/zod.pipe.js";
import {
  BulkActionSchema, BulkRequestSchema, DuplicateResolvedSchema, ListOrdersQuerySchema, NewOrderSchema, OrderCreatedSchema, OrderDetailSchema, OrderPageSchema, OrderProductsQuerySchema, OrderProductsSchema, ResolveDuplicateSchema,
  RevealedCustomerSchema, type ListOrdersQuery,
  OrderDocumentsRequestSchema, OrderDocumentsSchema, OrderEditInputSchema, OrderEditResultSchema, OrderFiltersSchema, OrderNoteInputSchema, OrderNoteSchema, OrderNotesSchema, OrderTagsPatchSchema, OrderTagsSchema, SavedViewInputSchema, SavedViewListSchema, SavedViewSchema,
} from "./orders.dto.js";
import { OrderNotesService } from "./order-notes.service.js";
import { OrderEditsService } from "./order-edits.service.js";
import { OrderDocumentsService } from "./order-documents.service.js";
import { ManualOrdersService } from "./manual-orders.service.js";
import { BulkActionsService } from "./bulk.service.js";
import { DuplicatesService, OrderSettingsSchema, type OrderSettings } from "./duplicates.service.js";
import { OrdersService } from "./orders.service.js";

@ApiTags("orders")
@Controller("orders")
export class OrdersController {
  constructor(
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(DuplicatesService) private readonly duplicates: DuplicatesService,
    @Inject(ManualOrdersService) private readonly manual: ManualOrdersService,
    @Inject(BulkActionsService) private readonly bulk: BulkActionsService,
    @Inject(OrderNotesService) private readonly extras: OrderNotesService,
    @Inject(OrderEditsService) private readonly edits: OrderEditsService,
    @Inject(OrderDocumentsService) private readonly docs: OrderDocumentsService,
  ) {}

  /** M1 list (E5-1): newest first, filters, search, cursor pages, counts per status. */
  @Get()
  @Roles("owner", "admin", "ops_manager", "finance", "agent", "warehouse")
  @ApiQueryZod(ListOrdersQuerySchema)
  @ApiJson(200, "OrderPage", OrderPageSchema, "Agents see orders assigned to them; warehouse sees confirmed and shipped orders")
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(ListOrdersQuerySchema)) q: ListOrdersQuery) {
    return this.orders.list(auth, q);
  }

  /** M1 detail (E5-2): lines, money, payments, shipments, timeline; the customer stays masked. */
  /** E5-5: an order taken by phone, WhatsApp or in person; it goes through confirmation like any other. */
  @Post()
  @HttpCode(201)
  @Roles("owner", "admin", "ops_manager", "agent")
  @ApiJsonBody("NewOrder", NewOrderSchema)
  @ApiJson(201, "OrderCreated", OrderCreatedSchema, "Created as M-1001, M-1002…; an agent's order is assigned to them; audited")
  @ApiProblems(422)
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(NewOrderSchema)) body: z.output<typeof NewOrderSchema>) {
    return this.manual.create(auth, body);
  }

  /** E5-4: assign, tag, confirm or cancel many orders; ship them (E7-2, warehouse too); follow it with GET /orders/bulk/{id}. */
  @Post("bulk")
  @HttpCode(202)
  @Roles("owner", "admin", "ops_manager", "warehouse")
  @ApiJsonBody("BulkRequest", BulkRequestSchema)
  @ApiJson(202, "BulkAction", BulkActionSchema, "Accepted: the worker applies it in chunks; audited")
  @ApiProblems(403, 409, 422)
  bulkRequest(@Auth() auth: AuthContext, @Body(new ZodPipe(BulkRequestSchema)) body: z.output<typeof BulkRequestSchema>) {
    return this.bulk.request(auth, body);
  }

  @Get("bulk/:bulkId")
  @Roles("owner", "admin", "ops_manager", "warehouse")
  @ApiJson(200, "BulkAction", BulkActionSchema, "Progress: done, skipped and failed so far, and why each order was skipped or failed")
  @ApiProblems(404)
  bulkProgress(@Auth() auth: AuthContext, @Param("bulkId", new ParseUUIDPipe()) id: string) {
    return this.bulk.get(auth.tenant!.id, id);
  }

  @Get("products")
  @Roles("owner", "admin", "ops_manager", "agent")
  @ApiQueryZod(OrderProductsQuerySchema)
  @ApiJson(200, "OrderProducts", OrderProductsSchema, "Active products to add to a manual order (100 at most)")
  products(@Auth() auth: AuthContext, @Query(new ZodPipe(OrderProductsQuerySchema)) q: z.output<typeof OrderProductsQuerySchema>) {
    return this.manual.products(auth.tenant!.id, q.q);
  }

  /**
   * O4: invoices or packing slips for up to 100 orders, with the delivery contact: decrypted for this
   * caller only, never cached, each order's view in the audit log (customer.pii_viewed).
   */
  @Post("documents")
  @HttpCode(200)
  @Roles("owner", "admin", "ops_manager", "agent", "warehouse")
  @NoIdempotency()
  @Header("Cache-Control", "no-store")
  @ApiJsonBody("OrderDocumentsRequest", OrderDocumentsRequestSchema)
  @ApiJson(200, "OrderDocuments", OrderDocumentsSchema, "What the documents print, in the order asked; audited per order")
  @ApiProblems(404, 422, 429)
  documents(@Auth() auth: AuthContext, @Body(new ZodPipe(OrderDocumentsRequestSchema)) body: z.output<typeof OrderDocumentsRequestSchema>) {
    return this.docs.documents(auth, body.orderIds, body.kind);
  }

  /** O2: the values the list's filters offer (tags, cities, couriers), within the caller's scope. */
  @Get("filters")
  @Roles("owner", "admin", "ops_manager", "finance", "agent", "warehouse")
  @ApiJson(200, "OrderFilters", OrderFiltersSchema, "Most orders first")
  filters(@Auth() auth: AuthContext) {
    return this.extras.filters(auth);
  }

  /** O2: the person's saved views and the team's shared ones. */
  @Get("views")
  @Roles("owner", "admin", "ops_manager", "finance", "agent", "warehouse")
  @ApiJson(200, "SavedViewList", SavedViewListSchema, "Own views and shared ones")
  views(@Auth() auth: AuthContext) {
    return this.extras.views(auth);
  }

  @Post("views")
  @HttpCode(201)
  @Roles("owner", "admin", "ops_manager", "finance", "agent", "warehouse")
  @ApiJsonBody("SavedViewInput", SavedViewInputSchema)
  @ApiJson(201, "SavedView", SavedViewSchema, "Saved; shared views are for the owner, an admin or the ops manager to make")
  @ApiProblems(403, 409, 422)
  saveView(@Auth() auth: AuthContext, @Body(new ZodPipe(SavedViewInputSchema)) body: z.output<typeof SavedViewInputSchema>) {
    return this.extras.saveView(auth, body);
  }

  @Delete("views/:viewId")
  @HttpCode(204)
  @Roles("owner", "admin", "ops_manager", "finance", "agent", "warehouse")
  @ApiNoContent("Removed")
  @ApiProblems(403, 404)
  async removeView(@Auth() auth: AuthContext, @Param("viewId", new ParseUUIDPipe()) id: string) {
    await this.extras.removeView(auth, id);
  }

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

  /**
   * O3: change the order before it ships. A manual order changes now (200 applied); a store order's
   * edit goes to the store and the order follows when the store has it (202 sending). Audited.
   */
  @Patch(":id")
  @Roles("owner", "admin", "ops_manager", "agent")
  @ApiJsonBody("OrderEditInput", OrderEditInputSchema)
  @ApiJson(200, "OrderEditResult", OrderEditResultSchema, "applied: a manual order, changed now")
  @ApiJson(202, "OrderEditResult", OrderEditResultSchema, "sending: on its way to the store; the order follows when the store has it")
  @ApiProblems(404, 409, 422)
  async editOrder(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string, @Body(new ZodPipe(OrderEditInputSchema)) body: z.output<typeof OrderEditInputSchema>,
    @Res({ passthrough: true }) reply: { status(code: number): unknown }) {
    const r = await this.edits.edit(auth, id, body);
    if (r.status === "sending") reply.status(202);
    return r;
  }

  /** O2: the team's notes on the order, newest first; never sent to the store. */
  @Get(":id/notes")
  @Roles("owner", "admin", "ops_manager", "finance", "agent", "warehouse")
  @Header("Cache-Control", "no-store")
  @ApiJson(200, "OrderNotes", OrderNotesSchema, "Newest first")
  @ApiProblems(404)
  notes(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.extras.notes(auth, id);
  }

  @Post(":id/notes")
  @HttpCode(201)
  @Roles("owner", "admin", "ops_manager", "agent", "warehouse")
  @ApiJsonBody("OrderNoteInput", OrderNoteInputSchema)
  @ApiJson(201, "OrderNote", OrderNoteSchema, "Added; the timeline says a note was added, not what it says")
  @ApiProblems(404, 409, 422)
  addNote(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string, @Body(new ZodPipe(OrderNoteInputSchema)) body: z.output<typeof OrderNoteInputSchema>) {
    return this.extras.addNote(auth, id, body.body);
  }

  @Delete(":id/notes/:noteId")
  @HttpCode(204)
  @Roles("owner", "admin", "ops_manager", "agent", "warehouse")
  @ApiNoContent("Removed; audited")
  @ApiProblems(403, 404)
  async removeNote(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string, @Param("noteId", new ParseUUIDPipe()) noteId: string) {
    await this.extras.removeNote(auth, id, noteId);
  }

  /** O2: add or take off tags; a Shopify order gets the change too (outbox). */
  @Patch(":id/tags")
  @Roles("owner", "admin", "ops_manager", "agent", "warehouse")
  @ApiJsonBody("OrderTagsPatch", OrderTagsPatchSchema)
  @ApiJson(200, "OrderTags", OrderTagsSchema, "The order's tags after the change")
  @ApiProblems(404, 422)
  setTags(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string, @Body(new ZodPipe(OrderTagsPatchSchema)) body: z.output<typeof OrderTagsPatchSchema>) {
    return this.extras.setTags(auth, id, body);
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

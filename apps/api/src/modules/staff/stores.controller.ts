import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Query, UseGuards, UseInterceptors } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { z } from "zod";
import { Auth, NoTenant } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { ApiJson, ApiJsonBody, ApiProblems, ApiQueryZod } from "../../platform/http/api-schema.js";
import { ZodPipe } from "../../platform/http/zod.pipe.js";
import { StaffAuditInterceptor } from "./staff-audit.interceptor.js";
import { PlatformGuard, StaffRoles } from "./staff.guard.js";
import { AddNoteSchema, ChangePlanSchema, NoteSchema, ReactivateStoreSchema, StoreDetailSchema, StoresPageSchema, StoresQuerySchema, StoreStateSchema, SuspendStoreSchema } from "./stores.dto.js";
import { StoresService } from "./stores.service.js";

/** Stores in the back office (A-2). Every staff member can look; changes need the right staff role. */
@ApiTags("platform")
@Controller("platform/stores")
@NoTenant()
@UseGuards(PlatformGuard)
@UseInterceptors(StaffAuditInterceptor)
export class StoresController {
  constructor(@Inject(StoresService) private readonly stores: StoresService) {}

  @Get()
  @ApiQueryZod(StoresQuerySchema)
  @ApiJson(200, "PlatformStores", StoresPageSchema, "Find stores by name, plan, status, country, signup date; sort by last month's orders. Deleted stores only when asked for.")
  @ApiProblems(403, 422)
  list(@Query(new ZodPipe(StoresQuerySchema)) q: z.output<typeof StoresQuerySchema>) {
    return this.stores.list(q);
  }

  @Get(":storeId")
  @ApiJson(200, "PlatformStore", StoreDetailSchema, "One store: team, integrations and their health, jobs and dead letters, usage, internal notes")
  @ApiProblems(403, 404)
  detail(@Param("storeId", new ParseUUIDPipe()) storeId: string) {
    return this.stores.detail(storeId);
  }

  @Post(":storeId/suspend")
  @HttpCode(200)
  @StaffRoles("super_admin")
  @ApiJsonBody("SuspendStore", SuspendStoreSchema)
  @ApiJson(200, "StoreState", StoreStateSchema, "Suspended: its members are refused (tenant_inactive); jobs and data are kept. Written to the store's audit log.")
  @ApiProblems(403, 404, 409, 422)
  suspend(@Auth() auth: AuthContext, @Param("storeId", new ParseUUIDPipe()) storeId: string, @Body(new ZodPipe(SuspendStoreSchema)) body: z.output<typeof SuspendStoreSchema>) {
    return this.stores.suspend(auth, storeId, body.reason);
  }

  @Post(":storeId/reactivate")
  @HttpCode(200)
  @StaffRoles("super_admin")
  @ApiJsonBody("ReactivateStore", ReactivateStoreSchema)
  @ApiJson(200, "StoreState", StoreStateSchema, "Active again. Written to the store's audit log.")
  @ApiProblems(403, 404, 409, 422)
  reactivate(@Auth() auth: AuthContext, @Param("storeId", new ParseUUIDPipe()) storeId: string, @Body(new ZodPipe(ReactivateStoreSchema)) body: z.output<typeof ReactivateStoreSchema>) {
    return this.stores.reactivate(auth, storeId, body.reason);
  }

  @Put(":storeId/plan")
  @StaffRoles("super_admin", "finance")
  @ApiJsonBody("ChangePlan", ChangePlanSchema)
  @ApiJson(200, "StoreState", StoreStateSchema, "The store's plan (limits follow at once). Written to the store's audit log; the same plan changes nothing.")
  @ApiProblems(403, 404, 409, 422)
  changePlan(@Auth() auth: AuthContext, @Param("storeId", new ParseUUIDPipe()) storeId: string, @Body(new ZodPipe(ChangePlanSchema)) body: z.output<typeof ChangePlanSchema>) {
    return this.stores.changePlan(auth, storeId, body.plan, body.reason);
  }

  @Post(":storeId/notes")
  @ApiJsonBody("AddStoreNote", AddNoteSchema)
  @ApiJson(201, "StoreNote", NoteSchema, "An internal note about the store (support context); the store never sees it")
  @ApiProblems(403, 404, 422)
  addNote(@Auth() auth: AuthContext, @Param("storeId", new ParseUUIDPipe()) storeId: string, @Body(new ZodPipe(AddNoteSchema)) body: z.output<typeof AddNoteSchema>) {
    return this.stores.addNote(auth, storeId, body.body);
  }
}

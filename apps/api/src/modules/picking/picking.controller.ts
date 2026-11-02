import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { z } from "zod";
import { Auth, Roles } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { ApiJson, ApiJsonBody, ApiProblems, ApiQueryZod } from "../../platform/http/api-schema.js";
import { ZodPipe } from "../../platform/http/zod.pipe.js";
import { NewPickListSchema, PickListPageSchema, PickListSchema, PickListsQuerySchema } from "./picking.dto.js";
import { PickingService } from "./picking.service.js";

/** M4 pick lists (E8-4c): the warehouse batches confirmed orders, picks by shelf, packs by scan on the phone. */
@ApiTags("picking")
@Controller("picklists")
@Roles("owner", "admin", "ops_manager", "warehouse")
export class PickingController {
  constructor(@Inject(PickingService) private readonly picking: PickingService) {}

  @Post()
  @ApiJsonBody("NewPickList", NewPickListSchema)
  @ApiJson(201, "PickList", PickListSchema, "Created from the given or the oldest ready confirmed orders; audited")
  @ApiProblems(409)
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(NewPickListSchema)) body: z.output<typeof NewPickListSchema>) {
    return this.picking.create(auth, body);
  }

  @Get()
  @ApiQueryZod(PickListsQuerySchema)
  @ApiJson(200, "PickListPage", PickListPageSchema, "Open (or closed) pick lists, newest first, with packed counts")
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(PickListsQuerySchema)) q: z.output<typeof PickListsQuerySchema>) {
    return this.picking.list(auth.tenant!.id, q.status);
  }

  @Get(":id")
  @ApiJson(200, "PickList", PickListSchema, "Items by shelf for the unpacked orders, and each order's lines to scan")
  @ApiProblems(404)
  get(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.picking.get(auth.tenant!.id, id);
  }

  @Post(":id/close")
  @HttpCode(200)
  @ApiJson(200, "PickList", PickListSchema, "Closed (its unpacked orders can go on a new list); audited")
  @ApiProblems(404)
  close(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.picking.close(auth, id);
  }
}

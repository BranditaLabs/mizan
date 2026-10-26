import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { z } from "zod";
import { Auth, Roles } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { ApiJson, ApiJsonBody, ApiNoContent, ApiProblems, ApiQueryZod } from "../../platform/http/api-schema.js";
import { ZodPipe } from "../../platform/http/zod.pipe.js";
import {
  AutomationDetailSchema, AutomationInputSchema, AutomationListSchema, AutomationPatchSchema, AutomationSchema, CatalogSchema, DryRunResultSchema, DryRunSchema,
  MarkedSchema, MarkReadSchema, NotificationListSchema, NotificationsQuerySchema,
} from "./automations.dto.js";
import { AutomationsService } from "./automations.service.js";
import { catalog } from "./catalog.js";
import { NotificationsService } from "./notifications.service.js";

/** Automation Studio (M13, E11-1): automations, their run log and dry runs. Owner, admin, ops manager. */
@ApiTags("automations")
@Controller("automations")
@Roles("owner", "admin", "ops_manager")
export class AutomationsController {
  constructor(@Inject(AutomationsService) private readonly automations: AutomationsService) {}

  @Get()
  @ApiJson(200, "AutomationList", AutomationListSchema, "Every automation of the store, oldest first")
  list(@Auth() auth: AuthContext) {
    return this.automations.list(auth.tenant!.id);
  }

  @Post()
  @ApiJsonBody("AutomationInput", AutomationInputSchema)
  @ApiJson(201, "Automation", AutomationSchema, "Saved (off unless enabled is true)")
  @ApiProblems(422)
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(AutomationInputSchema)) body: z.infer<typeof AutomationInputSchema>) {
    return this.automations.create(auth, body);
  }

  @Get(":id")
  @ApiJson(200, "AutomationDetail", AutomationDetailSchema, "The automation and its last 50 runs")
  @ApiProblems(404)
  get(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.automations.get(auth.tenant!.id, id);
  }

  @Put(":id")
  @ApiJsonBody("AutomationInput", AutomationInputSchema)
  @ApiJson(200, "Automation", AutomationSchema, "Saved as a new version")
  @ApiProblems(404, 422)
  update(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string, @Body(new ZodPipe(AutomationInputSchema)) body: z.infer<typeof AutomationInputSchema>) {
    return this.automations.update(auth, id, body);
  }

  @Patch(":id")
  @ApiJsonBody("AutomationPatch", AutomationPatchSchema)
  @ApiJson(200, "Automation", AutomationSchema, "Turned on or off")
  @ApiProblems(404)
  patch(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string, @Body(new ZodPipe(AutomationPatchSchema)) body: z.infer<typeof AutomationPatchSchema>) {
    return this.automations.setEnabled(auth, id, body.enabled);
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiNoContent("Deleted with its run log")
  @ApiProblems(404)
  async remove(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string) {
    await this.automations.remove(auth, id);
  }

  @Post(":id/test")
  @HttpCode(200)
  @ApiJsonBody("DryRun", DryRunSchema)
  @ApiJson(200, "DryRunResult", DryRunResultSchema, "Each rule with its actual value, and the steps that would run; nothing is done")
  @ApiProblems(404, 422)
  test(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string, @Body(new ZodPipe(DryRunSchema)) body: z.infer<typeof DryRunSchema>) {
    return this.automations.dryRun(auth.tenant!.id, id, body);
  }
}

/** The catalogue the builder offers (E11-3): triggers, fields, operators, actions. */
@ApiTags("automations")
@Controller("catalog")
@Roles("owner", "admin", "ops_manager")
export class CatalogController {
  @Get()
  @ApiJson(200, "AutomationCatalog", CatalogSchema, "One registry in code; automations are checked against it")
  get() {
    return catalog();
  }
}

/** What the team should see (notify.team and alerts), for the caller's role. Every member. */
@ApiTags("automations")
@Controller("notifications")
export class NotificationsController {
  constructor(@Inject(NotificationsService) private readonly notifications: NotificationsService) {}

  @Get()
  @ApiQueryZod(NotificationsQuerySchema)
  @ApiJson(200, "NotificationList", NotificationListSchema, "Newest first, with how many are unread")
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(NotificationsQuerySchema)) q: z.output<typeof NotificationsQuerySchema>) {
    return this.notifications.list(auth, q.limit);
  }

  @Post("read")
  @HttpCode(200)
  @ApiJsonBody("MarkRead", MarkReadSchema)
  @ApiJson(200, "Marked", MarkedSchema, "Marked read for the caller")
  markRead(@Auth() auth: AuthContext, @Body(new ZodPipe(MarkReadSchema)) body: z.infer<typeof MarkReadSchema>) {
    return this.notifications.markRead(auth, body);
  }
}

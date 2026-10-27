import { Controller, Get, Header, Inject, Param, Query, StreamableFile } from "@nestjs/common";
import { ApiProduces, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Auth, Roles } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { ApiJson, ApiProblems, ApiQueryZod } from "../../platform/http/api-schema.js";
import { ZodPipe } from "../../platform/http/zod.pipe.js";
import { DashboardListSchema, DashboardQuerySchema, DashboardSchema, ExportQuerySchema, type DashboardQuery, type ExportQuery } from "./dashboards.dto.js";
import { DashboardsService } from "./dashboards.service.js";

/** M20 built-in dashboards (E15-2): every number from the metric layer, and the same as a file. */
@ApiTags("reports")
@Controller("dashboards")
export class DashboardsController {
  constructor(@Inject(DashboardsService) private readonly dashboards: DashboardsService) {}

  @Get()
  @Roles("owner", "admin", "ops_manager", "finance", "agent", "warehouse")
  @ApiJson(200, "DashboardList", DashboardListSchema, "The dashboards the caller has at least one metric on")
  list(@Auth() auth: AuthContext) {
    return this.dashboards.list(auth);
  }

  @Get(":id")
  @Roles("owner", "admin", "ops_manager", "finance", "agent", "warehouse")
  @ApiQueryZod(DashboardQuerySchema)
  @ApiJson(200, "Dashboard", DashboardSchema, "Tiles and daily series for a period of store days, in the caller's language")
  @ApiProblems(404, 422)
  get(@Auth() auth: AuthContext, @Param("id") id: string, @Query(new ZodPipe(DashboardQuerySchema)) q: DashboardQuery) {
    return this.dashboards.get(auth, id, q);
  }

  @Get(":id/export")
  @Roles("owner", "admin", "ops_manager", "finance", "agent", "warehouse")
  @Header("Cache-Control", "no-store")
  @ApiQueryZod(ExportQuerySchema)
  @ApiProduces("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/csv")
  @ApiResponse({ status: 200, description: "The dashboard as an Excel or CSV file (attachment)", content: {
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { schema: { type: "string", format: "binary" } },
    "text/csv": { schema: { type: "string", format: "binary" } },
  } })
  @ApiProblems(404, 422)
  async export(@Auth() auth: AuthContext, @Param("id") id: string, @Query(new ZodPipe(ExportQuerySchema)) q: ExportQuery) {
    const file = await this.dashboards.export(auth, id, q, q.format);
    return new StreamableFile(file.body, { type: file.type, disposition: `attachment; filename="${file.filename}"`, length: file.body.length });
  }
}

import { Controller, Get, Inject, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Auth, Roles } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { ApiJson, ApiProblems, ApiQueryZod } from "../../platform/http/api-schema.js";
import { ZodPipe } from "../../platform/http/zod.pipe.js";
import { MetricCatalogueSchema, MetricValuesQuerySchema, MetricValuesSchema, type MetricValuesQuery } from "./metrics.dto.js";
import { MetricsService } from "./metrics.service.js";

/** M20 metrics (E15-1): one definition per number, the same on every screen. */
@ApiTags("reports")
@Controller("metrics")
export class ReportsController {
  constructor(@Inject(MetricsService) private readonly metrics: MetricsService) {}

  // Not `GET /v1/metrics`: the bare `GET /metrics` is the Prometheus endpoint (left out of the v1 prefix).
  @Get("catalogue")
  @Roles("owner", "admin", "ops_manager", "finance", "agent", "warehouse")
  @ApiJson(200, "MetricCatalogue", MetricCatalogueSchema, "The semantic metric catalogue the caller may see (name and definition in their language)")
  catalogue(@Auth() auth: AuthContext) {
    return this.metrics.catalogue(auth);
  }

  @Get("values")
  @Roles("owner", "admin", "ops_manager", "finance", "agent", "warehouse")
  @ApiQueryZod(MetricValuesQuerySchema)
  @ApiJson(200, "MetricValues", MetricValuesSchema, "Values for a period of store days; metrics the caller may not see are left out, never zero")
  @ApiProblems(422)
  values(@Auth() auth: AuthContext, @Query(new ZodPipe(MetricValuesQuerySchema)) q: MetricValuesQuery) {
    return this.metrics.values(auth, q);
  }
}

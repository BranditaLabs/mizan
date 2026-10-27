import { Module } from "@nestjs/common";
import { DashboardsController } from "./dashboards.controller.js";
import { DashboardsService } from "./dashboards.service.js";
import { MetricsService } from "./metrics.service.js";
import { ReportsController } from "./reports.controller.js";

/** M20 reports: the semantic metric layer (E15-1); dashboards and exports with E15-2. */
@Module({ controllers: [ReportsController, DashboardsController], providers: [MetricsService, DashboardsService], exports: [MetricsService] })
export class ReportsModule {}

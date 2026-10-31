import { Module } from "@nestjs/common";
import { ProfitModule } from "../profit/profit.module.js";
import { ReportsModule } from "../reports/reports.module.js";
import { AttributionController } from "./attribution.controller.js";
import { AttributionService } from "./attribution.service.js";

/** M7 ad-to-cash attribution: True ROAS from the spend recorded so far (M7-1); order sources, platform imports and conversion events next. */
@Module({ imports: [ProfitModule, ReportsModule], controllers: [AttributionController], providers: [AttributionService] })
export class AttributionModule {}

import { Global, Module } from "@nestjs/common";
import { CostRulesService } from "./cost-rules.service.js";
import { FxService } from "./fx/fx.service.js";
import { ProfitController } from "./profit.controller.js";

/** M5 Profit: cost rules and daily FX (E9-1); the profit service (E9-2) and home numbers (E9-4) join here. */
@Global()
@Module({ controllers: [ProfitController], providers: [CostRulesService, FxService], exports: [CostRulesService, FxService] })
export class ProfitModule {}

import { Global, Module } from "@nestjs/common";
import { CostRulesService } from "./cost-rules.service.js";
import { FxService } from "./fx/fx.service.js";
import { ProfitController } from "./profit.controller.js";
import { ProfitConsumer } from "./profit.consumer.js";
import { ProfitService } from "./profit.service.js";

/** M5 Profit: cost rules and daily FX (E9-1); the profit service (E9-2); home numbers (E9-4) join here. */
@Global()
@Module({ controllers: [ProfitController], providers: [CostRulesService, FxService, ProfitService, ProfitConsumer], exports: [CostRulesService, FxService, ProfitService] })
export class ProfitModule {}

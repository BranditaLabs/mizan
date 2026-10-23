import { Global, Module } from "@nestjs/common";
import { CostRulesService } from "./cost-rules.service.js";
import { FxService } from "./fx/fx.service.js";
import { ProfitController } from "./profit.controller.js";
import { ProfitConsumer } from "./profit.consumer.js";
import { ProfitService } from "./profit.service.js";
import { AdSpendService } from "./ads/ad-spend.service.js";
import { ProfitHomeService } from "./home.service.js";

/** M5 Profit: cost rules and daily FX (E9-1); the profit service (E9-2); ad spend (E9-3); the profit home (E9-4). */
@Global()
@Module({ controllers: [ProfitController], providers: [CostRulesService, FxService, ProfitService, ProfitConsumer, AdSpendService, ProfitHomeService], exports: [CostRulesService, FxService, ProfitService, AdSpendService] })
export class ProfitModule {}

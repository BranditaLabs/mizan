import { Global, Module } from "@nestjs/common";
import { StockConsumer } from "./stock.consumer.js";
import { StockPushConsumer } from "./stock-push.consumer.js";
import { InventorySettingsController, StockController } from "./stock.controller.js";
import { StockService } from "./stock.service.js";

/** M4 stock: levels, the movement ledger, what orders hold (E8-2); alerts and the store's count (E8-5). */
@Global()
@Module({ controllers: [StockController, InventorySettingsController], providers: [StockService, StockConsumer, StockPushConsumer], exports: [StockService] })
export class StockModule {}

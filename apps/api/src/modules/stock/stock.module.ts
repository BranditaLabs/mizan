import { Global, Module } from "@nestjs/common";
import { StockConsumer } from "./stock.consumer.js";
import { StockController } from "./stock.controller.js";
import { StockService } from "./stock.service.js";

/** M4 stock (E8-2): levels, the movement ledger, and what orders hold. */
@Global()
@Module({ controllers: [StockController], providers: [StockService, StockConsumer], exports: [StockService] })
export class StockModule {}

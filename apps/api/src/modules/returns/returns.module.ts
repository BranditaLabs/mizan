import { Module } from "@nestjs/common";
import { OrdersModule } from "../orders/orders.module.js";
import { ExchangesConsumer } from "./exchanges.consumer.js";
import { ExchangesController } from "./exchanges.controller.js";
import { ExchangesService } from "./exchanges.service.js";
import { ReturnsController } from "./returns.controller.js";
import { ReturnsService } from "./returns.service.js";

/** M6 returns: inspection (E10-3) and exchanges (E10-2). */
@Module({ imports: [OrdersModule], controllers: [ReturnsController, ExchangesController], providers: [ReturnsService, ExchangesService, ExchangesConsumer], exports: [ReturnsService] })
export class ReturnsModule {}

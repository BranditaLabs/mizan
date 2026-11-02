import { Module } from "@nestjs/common";
import { OrdersModule } from "../orders/orders.module.js";
import { DoorController } from "./door.controller.js";
import { DoorService } from "./door.service.js";
import { ExchangesConsumer } from "./exchanges.consumer.js";
import { ExchangesController } from "./exchanges.controller.js";
import { ExchangesService } from "./exchanges.service.js";
import { ReturnsController } from "./returns.controller.js";
import { ReturnsService } from "./returns.service.js";

/** M6 returns: inspection (E10-3), exchanges (E10-2), partial delivery and refusals (E10-4). */
@Module({ imports: [OrdersModule], controllers: [ReturnsController, ExchangesController, DoorController], providers: [ReturnsService, ExchangesService, ExchangesConsumer, DoorService], exports: [ReturnsService] })
export class ReturnsModule {}

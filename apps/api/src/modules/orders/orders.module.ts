import { Global, Module } from "@nestjs/common";
import { OrderProjector } from "./order-projector.js";
import { OrdersController } from "./orders.controller.js";
import { OrdersService } from "./orders.service.js";

/** M1 Orders: projecting store orders from the engine (E2-3), the list (E5-1), detail and audited reveal (E5-2). */
@Global()
@Module({ controllers: [OrdersController], providers: [OrderProjector, OrdersService], exports: [OrderProjector] })
export class OrdersModule {}

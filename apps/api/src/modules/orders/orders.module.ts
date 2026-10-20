import { Global, Module } from "@nestjs/common";
import { OrderProjector } from "./order-projector.js";

/** M1 Orders. Today: projecting store orders from the engine; list/detail endpoints come with E5. */
@Global()
@Module({ providers: [OrderProjector], exports: [OrderProjector] })
export class OrdersModule {}

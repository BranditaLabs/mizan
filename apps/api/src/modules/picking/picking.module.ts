import { Module } from "@nestjs/common";
import { PickingController } from "./picking.controller.js";
import { PickingService } from "./picking.service.js";

/** M4 pick lists and scan-to-pack (E8-4c); the ops sync applies `order.pack` through PickingService. */
@Module({ controllers: [PickingController], providers: [PickingService], exports: [PickingService] })
export class PickingModule {}

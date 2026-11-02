import { PickingModule } from "../picking/picking.module.js";
import { Module } from "@nestjs/common";
import { PurchasingModule } from "../purchasing/purchasing.module.js";
import { ReturnsModule } from "../returns/returns.module.js";
import { OpsController } from "./ops.controller.js";
import { OpsSyncService } from "./ops-sync.service.js";

/** The ops app's API (E8-3): batch sync (stock, return inspection); pick lists and scans with E8-4; receiving against a PO (M16-1). */
@Module({ imports: [ReturnsModule, PickingModule, PurchasingModule], controllers: [OpsController], providers: [OpsSyncService] })
export class OpsModule {}

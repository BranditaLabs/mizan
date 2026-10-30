import { PickingModule } from "../picking/picking.module.js";
import { Module } from "@nestjs/common";
import { ReturnsModule } from "../returns/returns.module.js";
import { OpsController } from "./ops.controller.js";
import { OpsSyncService } from "./ops-sync.service.js";

/** The ops app's API (E8-3): batch sync (stock, return inspection); pick lists and scans with E8-4. */
@Module({ imports: [ReturnsModule, PickingModule], controllers: [OpsController], providers: [OpsSyncService] })
export class OpsModule {}

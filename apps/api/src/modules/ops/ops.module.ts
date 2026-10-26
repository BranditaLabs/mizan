import { Module } from "@nestjs/common";
import { OpsController } from "./ops.controller.js";
import { OpsSyncService } from "./ops-sync.service.js";

/** The ops app's API (E8-3): batch sync now; pick lists and scans with E8-4. */
@Module({ controllers: [OpsController], providers: [OpsSyncService] })
export class OpsModule {}

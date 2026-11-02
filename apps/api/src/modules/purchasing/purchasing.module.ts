import { Module } from "@nestjs/common";
import { LandedCostsController, ReorderController, PurchaseOrdersController, PurchasingSettingsController, SuppliersController } from "./purchasing.controller.js";
import { PurchasingService } from "./purchasing.service.js";
import { ReorderService } from "./reorder.service.js";

/** M16 Purchasing (M16-1): suppliers, POs, receiving with moving-average cost; the ops sync applies `po.receive` through PurchasingService. */
@Module({ controllers: [SuppliersController, PurchaseOrdersController, LandedCostsController, ReorderController, PurchasingSettingsController], providers: [PurchasingService, ReorderService], exports: [PurchasingService, ReorderService] })
export class PurchasingModule {}

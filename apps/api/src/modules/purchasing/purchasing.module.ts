import { Module } from "@nestjs/common";
import { PurchaseOrdersController, PurchasingSettingsController, SuppliersController } from "./purchasing.controller.js";
import { PurchasingService } from "./purchasing.service.js";

/** M16 Purchasing (M16-1): suppliers, POs, receiving with moving-average cost; the ops sync applies `po.receive` through PurchasingService. */
@Module({ controllers: [SuppliersController, PurchaseOrdersController, PurchasingSettingsController], providers: [PurchasingService], exports: [PurchasingService] })
export class PurchasingModule {}

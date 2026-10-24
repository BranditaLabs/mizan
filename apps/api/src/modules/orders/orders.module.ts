import { Global, Module } from "@nestjs/common";
import { OrderProjector } from "./order-projector.js";
import { OrderSettingsController, OrdersController } from "./orders.controller.js";
import { OrdersService } from "./orders.service.js";
import { DuplicatesService } from "./duplicates.service.js";
import { ReconciliationService } from "./reconciliation.service.js";
import { RiskService } from "./risk.service.js";

/** M1 Orders: projecting store orders from the engine (E2-3), the list (E5-1), detail and audited reveal (E5-2), likely duplicates (E5-3), nightly reconciliation (E5-8), risk score (E6-1). */
@Global()
@Module({ controllers: [OrdersController, OrderSettingsController], providers: [OrderProjector, OrdersService, DuplicatesService, ReconciliationService, RiskService], exports: [OrderProjector, DuplicatesService, ReconciliationService] })
export class OrdersModule {}

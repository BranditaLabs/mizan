import { Global, Module } from "@nestjs/common";
import { OrderProjector } from "./order-projector.js";
import { OrderSettingsController, OrdersController } from "./orders.controller.js";
import { OrdersService } from "./orders.service.js";
import { DuplicatesService } from "./duplicates.service.js";
import { ReconciliationService } from "./reconciliation.service.js";
import { RiskService } from "./risk.service.js";
import { ManualOrdersService } from "./manual-orders.service.js";
import { BulkActionsService } from "./bulk.service.js";
import { BulkActionsConsumer } from "./bulk.consumer.js";
import { CANCEL_RESULTS } from "./ports.js";
import { OrderActions } from "./order-actions.js";

/** M1 Orders: projecting store orders from the engine (E2-3), the list (E5-1), detail and audited reveal (E5-2), likely duplicates (E5-3), nightly reconciliation (E5-8), risk score (E6-1), manual orders (E5-5), bulk actions (E5-4). */
@Global()
@Module({ controllers: [OrdersController, OrderSettingsController], providers: [OrderActions, OrderProjector, OrdersService, ManualOrdersService, BulkActionsService, BulkActionsConsumer, { provide: CANCEL_RESULTS, useExisting: BulkActionsService }, DuplicatesService, ReconciliationService, RiskService], exports: [OrderActions, CANCEL_RESULTS, OrderProjector, DuplicatesService, ReconciliationService] })
export class OrdersModule {}

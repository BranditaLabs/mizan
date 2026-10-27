import { Global, Module } from "@nestjs/common";
import { LedgerService } from "./ledger.service.js";
import { PaymentsController, PaymentsListController } from "./payments.controller.js";
import { PaymentsListService } from "./payments-list.service.js";
import { OrderRefundsController, RefundSettingsController, RefundsController } from "./refunds.controller.js";
import { RefundsService } from "./refunds.service.js";

/** M15 payments: the ledger every money movement goes through (E14-1); the payments screen and mix (E14-6); refunds (E14-4). */
@Global()
@Module({ controllers: [PaymentsController, PaymentsListController, OrderRefundsController, RefundsController, RefundSettingsController], providers: [LedgerService, PaymentsListService, RefundsService], exports: [LedgerService] })
export class PaymentsModule {}

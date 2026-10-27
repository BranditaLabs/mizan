import { Global, Module } from "@nestjs/common";
import { LedgerService } from "./ledger.service.js";
import { PaymentsController, PaymentsListController } from "./payments.controller.js";
import { PaymentsListService } from "./payments-list.service.js";

/** M15 payments: the ledger every money movement goes through (E14-1); the payments screen and mix (E14-6). */
@Global()
@Module({ controllers: [PaymentsController, PaymentsListController], providers: [LedgerService, PaymentsListService], exports: [LedgerService] })
export class PaymentsModule {}

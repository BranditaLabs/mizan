import { Global, Module } from "@nestjs/common";
import { LedgerService } from "./ledger.service.js";
import { PaymentsController } from "./payments.controller.js";

/** M15 payments: the ledger every money movement goes through (E14-1). */
@Global()
@Module({ controllers: [PaymentsController], providers: [LedgerService], exports: [LedgerService] })
export class PaymentsModule {}

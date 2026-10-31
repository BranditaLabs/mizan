import { Global, Module } from "@nestjs/common";
import { CodCollectionConsumer } from "./cod-collection.consumer.js";
import { ConversionConsumer } from "./conversion.consumer.js";
import { ConversionSettingsController, OrderConversionController } from "./conversion.controller.js";
import { ConversionService } from "./conversion.service.js";
import { DisputesController, OrderDisputesController } from "./disputes.controller.js";
import { DisputesService } from "./disputes.service.js";
import { LedgerService } from "./ledger.service.js";
import { PaymentsController, PaymentsListController } from "./payments.controller.js";
import { PaymentsListService } from "./payments-list.service.js";
import { OrderRefundsController, RefundSettingsController, RefundsController } from "./refunds.controller.js";
import { RefundsService } from "./refunds.service.js";

/** M15 payments: the ledger every money movement goes through (E14-1); the payments screen and mix (E14-6); refunds (E14-4); COD to prepaid conversion (E14-3); disputes (E14-5). */
@Global()
@Module({ controllers: [PaymentsController, PaymentsListController, OrderRefundsController, RefundsController, RefundSettingsController, OrderConversionController, ConversionSettingsController, OrderDisputesController, DisputesController], providers: [LedgerService, PaymentsListService, RefundsService, CodCollectionConsumer, ConversionService, ConversionConsumer, DisputesService], exports: [LedgerService, ConversionService] })
export class PaymentsModule {}

import { Module } from "@nestjs/common";
import { BillingController } from "./billing.controller.js";
import { UsageCloser } from "./usage-closer.service.js";
import { UsageService } from "./usage.service.js";

/** Billing (E12): usage metering (E12-3); plan limits (E12-1) and subscriptions (E12-2) next. */
@Module({ controllers: [BillingController], providers: [UsageService, UsageCloser], exports: [UsageService] })
export class BillingModule {}

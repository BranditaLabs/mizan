import { Module } from "@nestjs/common";
import { BillingController } from "./billing.controller.js";
import { UsageCloser } from "./usage-closer.service.js";
import { UsageService } from "./usage.service.js";
import { LimitsConsumer } from "./limits.consumer.js";

/** Billing (E12): usage metering (E12-3) and soft plan limits (E12-1); subscriptions (E12-2) next. */
@Module({ controllers: [BillingController], providers: [UsageService, UsageCloser, LimitsConsumer], exports: [UsageService] })
export class BillingModule {}

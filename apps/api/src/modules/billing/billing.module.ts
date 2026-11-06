import { Module } from "@nestjs/common";
import { BillingController } from "./billing.controller.js";
import { UsageCloser } from "./usage-closer.service.js";
import { UsageService } from "./usage.service.js";
import { LimitsConsumer } from "./limits.consumer.js";
import { SubscriptionService } from "./subscription.service.js";
import { TrialService } from "./trial.service.js";
import { TrialDomainConsumer } from "./trial-domain.consumer.js";

/** Billing (E12): usage metering (E12-3), soft plan limits (E12-1) and subscriptions (E12-2a: the state machine and the trial). */
@Module({ controllers: [BillingController], providers: [UsageService, UsageCloser, LimitsConsumer, SubscriptionService, TrialService, TrialDomainConsumer], exports: [UsageService, SubscriptionService, TrialService] })
export class BillingModule {}

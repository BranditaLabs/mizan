import { Global, Module } from "@nestjs/common";
import { OnboardingController } from "./onboarding.controller.js";
import { OnboardingService } from "./onboarding.service.js";
import { ProductEventsConsumer } from "./product-events.consumer.js";
import { ProductEventsService } from "./product-events.service.js";

/** Onboarding and product events (E4-5). Global: modules record their own product events. */
@Global()
@Module({ controllers: [OnboardingController], providers: [OnboardingService, ProductEventsService, ProductEventsConsumer], exports: [ProductEventsService] })
export class OnboardingModule {}

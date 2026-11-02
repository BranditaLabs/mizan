import { Global, Module } from "@nestjs/common";
import { PrivacyConsumer } from "./privacy.consumer.js";
import { PrivacyController } from "./privacy.controller.js";
import { PrivacyService } from "./privacy.service.js";

/** Privacy requests: Shopify compliance webhooks (E3-3); merchant and customer requests later. Global: webhook ingress records requests. */
@Global()
@Module({ controllers: [PrivacyController], providers: [PrivacyService, PrivacyConsumer], exports: [PrivacyService] })
export class PrivacyModule {}

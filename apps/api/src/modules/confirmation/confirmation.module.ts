import { Global, Module } from "@nestjs/common";
import { ConfirmationAnalytics } from "./analytics.service.js";
import { ConfirmationConsumer } from "./confirmation.consumer.js";
import { ConfirmationController, PublicConfirmationController } from "./confirmation.controller.js";
import { ConfirmationRunner } from "./confirmation.runner.js";
import { ConfirmationService } from "./confirmation.service.js";
import { MessagingRegistry } from "./messaging.registry.js";
import { WhatsAppChat } from "./whatsapp-chat.service.js";
import { WhatsAppConnections } from "./whatsapp-connections.service.js";
import { OffersController } from "./offers/offers.controller.js";
import { OffersService } from "./offers/offers.service.js";
import { OfferAi } from "./offers/offer-ai.service.js";
import { OfferApplyConsumer } from "./offers/offer-apply.consumer.js";
import { OFFER_RESULTS } from "../../integrations/engine-registry.js";

/** M2 Confirmation (E6-7, E6-10…E6-13, E6-6): automated cascade, the WhatsApp chat, team calls, offers, the customer's link, settings, results. */
@Global()
@Module({
  controllers: [ConfirmationController, PublicConfirmationController, OffersController],
  providers: [ConfirmationService, ConfirmationAnalytics, ConfirmationRunner, ConfirmationConsumer, MessagingRegistry, WhatsAppChat, WhatsAppConnections, OffersService, OfferAi, OfferApplyConsumer,
    { provide: OFFER_RESULTS, useExisting: OffersService }],
  exports: [ConfirmationService, ConfirmationRunner, MessagingRegistry, WhatsAppChat, WhatsAppConnections, OfferAi, OFFER_RESULTS],
})
export class ConfirmationModule {}

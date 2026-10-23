import { Global, Module } from "@nestjs/common";
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

/** M2 Confirmation (E6-7, E6-10): automated cascade, the WhatsApp chat, team calls, the customer's link, settings. */
@Global()
@Module({
  controllers: [ConfirmationController, PublicConfirmationController, OffersController],
  providers: [ConfirmationService, ConfirmationRunner, ConfirmationConsumer, MessagingRegistry, WhatsAppChat, WhatsAppConnections, OffersService, OfferAi],
  exports: [ConfirmationService, ConfirmationRunner, MessagingRegistry, WhatsAppChat, WhatsAppConnections, OfferAi],
})
export class ConfirmationModule {}

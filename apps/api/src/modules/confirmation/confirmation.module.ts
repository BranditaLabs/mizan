import { Global, Module } from "@nestjs/common";
import { ConfirmationConsumer } from "./confirmation.consumer.js";
import { ConfirmationController, PublicConfirmationController } from "./confirmation.controller.js";
import { ConfirmationRunner } from "./confirmation.runner.js";
import { ConfirmationService } from "./confirmation.service.js";
import { MessagingRegistry } from "./messaging.registry.js";
import { WhatsAppChat } from "./whatsapp-chat.service.js";
import { WhatsAppConnections } from "./whatsapp-connections.service.js";

/** M2 Confirmation (E6-7, E6-10): automated cascade, the WhatsApp chat, team calls, the customer's link, settings. */
@Global()
@Module({
  controllers: [ConfirmationController, PublicConfirmationController],
  providers: [ConfirmationService, ConfirmationRunner, ConfirmationConsumer, MessagingRegistry, WhatsAppChat, WhatsAppConnections],
  exports: [ConfirmationService, ConfirmationRunner, MessagingRegistry, WhatsAppChat, WhatsAppConnections],
})
export class ConfirmationModule {}

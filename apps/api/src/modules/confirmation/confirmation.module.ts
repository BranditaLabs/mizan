import { Global, Module } from "@nestjs/common";
import { ConfirmationConsumer } from "./confirmation.consumer.js";
import { ConfirmationController, PublicConfirmationController } from "./confirmation.controller.js";
import { ConfirmationRunner } from "./confirmation.runner.js";
import { ConfirmationService } from "./confirmation.service.js";
import { MessagingRegistry } from "./messaging.registry.js";

/** M2 Confirmation (E6-7): automated cascade, the customer's link, agent answers, settings. */
@Global()
@Module({
  controllers: [ConfirmationController, PublicConfirmationController],
  providers: [ConfirmationService, ConfirmationRunner, ConfirmationConsumer, MessagingRegistry],
  exports: [ConfirmationService, ConfirmationRunner, MessagingRegistry],
})
export class ConfirmationModule {}

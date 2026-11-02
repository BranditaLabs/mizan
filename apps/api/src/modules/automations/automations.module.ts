import { Module } from "@nestjs/common";
import { AutomationsConsumer } from "./automations.consumer.js";
import { AutomationsController, CatalogController, NotificationsController } from "./automations.controller.js";
import { AutomationsService } from "./automations.service.js";
import { NotificationsService } from "./notifications.service.js";
import { AutomationRuntime } from "./runtime.js";

/** M13 Automation Studio core (E11-1, E11-3): catalogue, runtime, run log, dry runs, team notifications. */
@Module({
  controllers: [AutomationsController, CatalogController, NotificationsController],
  providers: [AutomationRuntime, AutomationsService, AutomationsConsumer, NotificationsService],
})
export class AutomationsModule {}

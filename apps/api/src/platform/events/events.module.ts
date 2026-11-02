import { Global, Module } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import { EVENTS_CLOCK, EventDispatcher } from "./dispatcher.js";
import { EventsService } from "./events.service.js";

@Global()
@Module({
  imports: [DiscoveryModule],
  providers: [EventsService, EventDispatcher, { provide: EVENTS_CLOCK, useValue: () => new Date() }],
  exports: [EventsService, EventDispatcher],
})
export class EventsModule {}

import { Module } from "@nestjs/common";
import { TicketsController } from "./tickets.controller.js";
import { TicketsService } from "./tickets.service.js";

/** M6 returns and tickets: tickets (E10-1). */
@Module({ controllers: [TicketsController], providers: [TicketsService], exports: [TicketsService] })
export class TicketsModule {}

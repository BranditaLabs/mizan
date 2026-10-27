import { Module } from "@nestjs/common";
import { ReturnsController } from "./returns.controller.js";
import { ReturnsService } from "./returns.service.js";

/** M6 returns: inspection (E10-3); exchanges come with E10-2. */
@Module({ controllers: [ReturnsController], providers: [ReturnsService], exports: [ReturnsService] })
export class ReturnsModule {}

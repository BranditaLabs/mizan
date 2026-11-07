import { Module } from "@nestjs/common";
import { LiveController } from "./live.controller.js";
import { LiveHub } from "./live.hub.js";
import { LiveTokens } from "./live.tokens.js";

/** Live updates (LV-1a): SSE stream of each store's domain events and notifications. */
@Module({ controllers: [LiveController], providers: [LiveHub, LiveTokens], exports: [LiveHub] })
export class LiveModule {}

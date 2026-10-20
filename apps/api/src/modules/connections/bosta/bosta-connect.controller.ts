import { Body, Controller, Get, Inject, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { z } from "zod";
import { Auth, Roles } from "../../../platform/auth/decorators.js";
import type { AuthContext } from "../../../platform/auth/auth.types.js";
import { ApiJson, ApiJsonBody, ApiProblems } from "../../../platform/http/api-schema.js";
import { ZodPipe } from "../../../platform/http/zod.pipe.js";
import { BostaKeySchema, ConnectionListSchema, ConnectionViewSchema } from "../connections.dto.js";
import { BostaConnectService } from "./bosta-connect.service.js";

@ApiTags("connections")
@Controller("connections")
export class ConnectionsController {
  constructor(@Inject(BostaConnectService) private readonly bosta: BostaConnectService) {}

  /** The store's connections and their state (onboarding, settings). */
  @Get()
  @Roles("owner", "admin", "ops_manager")
  @ApiJson(200, "Connections", ConnectionListSchema, "Store, courier and other connections")
  async list(@Auth() auth: AuthContext) {
    return { data: await this.bosta.list(auth.tenant!.id) };
  }

  /** Connect (or replace the key of) Bosta. Answers `pending`; the key is checked in the background. */
  @Post("bosta")
  @Roles("owner", "admin")
  @ApiJsonBody("BostaKey", BostaKeySchema)
  @ApiJson(201, "Connection", ConnectionViewSchema, "Saved; status pending until the key is checked")
  @ApiProblems(409)
  saveBosta(@Auth() auth: AuthContext, @Body(new ZodPipe(BostaKeySchema)) body: z.infer<typeof BostaKeySchema>) {
    return this.bosta.saveKey(auth, body.apiKey);
  }
}

import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { z } from "zod";
import { Auth, Can } from "../../../platform/auth/decorators.js";
import type { AuthContext } from "../../../platform/auth/auth.types.js";
import { ApiJson, ApiJsonBody, ApiProblems } from "../../../platform/http/api-schema.js";
import { ZodPipe } from "../../../platform/http/zod.pipe.js";
import { BostaKeySchema, ConnectionListSchema, ConnectionViewSchema, DisconnectConnectionSchema, RenameConnectionSchema } from "../connections.dto.js";
import { BostaConnectService } from "./bosta-connect.service.js";

@ApiTags("connections")
@Controller("connections")
export class ConnectionsController {
  constructor(@Inject(BostaConnectService) private readonly bosta: BostaConnectService) {}

  /** The store's connections and their state (onboarding, settings). */
  @Get()
  @Can("connections.read")
  @ApiJson(200, "Connections", ConnectionListSchema, "Store, courier and other connections")
  async list(@Auth() auth: AuthContext) {
    return { data: await this.bosta.list(auth.tenant!.id) };
  }

  /** Connect (or replace the key of) Bosta. Answers `pending`; the key is checked in the background. */
  @Post("bosta")
  @Can("connections.manage")
  @ApiJsonBody("BostaKey", BostaKeySchema)
  @ApiJson(201, "Connection", ConnectionViewSchema, "Saved; status pending until the key is checked")
  @ApiProblems(409)
  saveBosta(@Auth() auth: AuthContext, @Body(new ZodPipe(BostaKeySchema)) body: z.infer<typeof BostaKeySchema>) {
    return this.bosta.saveKey(auth, body.apiKey);
  }

  /** U7: the team's own name for a store or courier (audited). */
  @Patch(":id")
  @Can("connections.manage")
  @ApiJsonBody("RenameConnection", RenameConnectionSchema)
  @ApiJson(200, "Connection", ConnectionViewSchema, "Renamed")
  @ApiProblems(404)
  rename(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string, @Body(new ZodPipe(RenameConnectionSchema)) body: z.infer<typeof RenameConnectionSchema>) {
    return this.bosta.rename(auth, id, body.displayName);
  }

  /**
   * U7: stop using a store or courier. Mizan stops syncing, forgets the credential and drops queued
   * jobs; orders and history stay; it can be connected again. `confirm` must be the store's address
   * (or, without one, the provider's name).
   */
  @Post(":id/disconnect")
  @HttpCode(200)
  @Can("connections.manage")
  @ApiJsonBody("DisconnectConnection", DisconnectConnectionSchema)
  @ApiJson(200, "Connection", ConnectionViewSchema, "Disconnected")
  @ApiProblems(404, 409, 422)
  disconnect(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string, @Body(new ZodPipe(DisconnectConnectionSchema)) body: z.infer<typeof DisconnectConnectionSchema>, @Req() req: { ip?: string }) {
    return this.bosta.disconnect(auth, id, body.confirm, req.ip);
  }
}

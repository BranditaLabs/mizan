import { Body, Controller, Get, Header, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Query, Req, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import type { z } from "zod";
import { Auth, Public, Roles } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { ApiJson, ApiJsonBody, ApiProblems, ApiQueryZod } from "../../platform/http/api-schema.js";
import { NoIdempotency } from "../../platform/http/idempotency.interceptor.js";
import { RateLimiter } from "../../platform/http/rate-limit.js";
import { ZodPipe } from "../../platform/http/zod.pipe.js";
import {
  AgentAnswerSchema, AnswerResultSchema, CallQueueNextSchema, CallQueueSchema, ConfirmationLinkSchema, ConfirmationSummaryQuerySchema, ConfirmationSummarySchema, ConfirmationSettingsViewSchema, NoAnswerSchema, OrderConfirmationSchema, PublicAnswerSchema, PublicConfirmationSchema, ScriptPreviewRequestSchema, ScriptPreviewSchema, WhatsAppConnectSchema,
} from "./confirmation.dto.js";
import { ConnectionViewSchema } from "../connections/connections.dto.js";
import { WhatsAppConnections } from "./whatsapp-connections.service.js";
import { ConfirmationService } from "./confirmation.service.js";
import { ConfirmationAnalytics } from "./analytics.service.js";
import { CallQueueService } from "./call-queue.service.js";
import { ConfirmationSettingsSchema, type ConfirmationSettings } from "./confirmation.settings.js";

/** M2 staff side (E6-7): an order's confirmation, the hand-sent link, an agent's answer, store settings, results (E6-6). */
@ApiTags("confirmation")
@Controller()
export class ConfirmationController {
  constructor(
    @Inject(ConfirmationService) private readonly confirmations: ConfirmationService,
    @Inject(WhatsAppConnections) private readonly whatsapp: WhatsAppConnections,
    @Inject(ConfirmationAnalytics) private readonly analytics: ConfirmationAnalytics,
    @Inject(CallQueueService) private readonly queue: CallQueueService,
  ) {}

  @Get("orders/:id/confirmation")
  @Roles("owner", "admin", "ops_manager", "agent")
  @ApiJson(200, "OrderConfirmation", OrderConfirmationSchema, "The order's confirmation run, its steps and the answers so far")
  @ApiProblems(404)
  summary(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.confirmations.summary(auth, id);
  }

  @Post("orders/:id/confirmation/link")
  @Roles("owner", "admin", "ops_manager", "agent")
  @HttpCode(200)
  @NoIdempotency()
  @Header("Cache-Control", "no-store")
  @ApiJson(200, "ConfirmationLink", ConfirmationLinkSchema, "The customer's confirm link and a WhatsApp link with the message, to send by hand; audited")
  @ApiProblems(404, 409)
  link(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.confirmations.manualLink(auth, id);
  }

  @Post("orders/:id/confirmation")
  @Roles("owner", "admin", "ops_manager", "agent")
  @HttpCode(200)
  @ApiJsonBody("AgentAnswer", AgentAnswerSchema)
  @ApiJson(200, "AnswerResult", AnswerResultSchema, "Confirmed or cancelled by an agent; audited")
  @ApiProblems(404, 409)
  answer(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string, @Body(new ZodPipe(AgentAnswerSchema)) body: z.output<typeof AgentAnswerSchema>) {
    return this.confirmations.agentAnswer(auth, id, body);
  }

  @Post("orders/:id/confirmation/no-answer")
  @Roles("owner", "admin", "ops_manager", "agent")
  @HttpCode(200)
  @ApiJson(200, "NoAnswer", NoAnswerSchema, "The team called and nobody answered: the order leaves the call list until the store's retry time; audited")
  @ApiProblems(404, 409)
  noAnswer(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.confirmations.noAnswer(auth, id);
  }

  @Post("connections/whatsapp")
  @Roles("owner", "admin")
  @HttpCode(200)
  @NoIdempotency()
  @ApiJsonBody("WhatsAppConnect", WhatsAppConnectSchema)
  @ApiJson(200, "ConnectionView", ConnectionViewSchema, "Saved (token encrypted) as pending; checked in the background: active when the token works and the confirmation template is approved, else needs_attention (token_refused, token_lacks_permission, template_pending, template_rejected, template_missing)")
  @ApiProblems(409)
  connectWhatsApp(@Auth() auth: AuthContext, @Body(new ZodPipe(WhatsAppConnectSchema)) body: z.output<typeof WhatsAppConnectSchema>) {
    return this.whatsapp.save(auth, body);
  }

  @Post("connections/whatsapp/check")
  @Roles("owner", "admin", "ops_manager")
  @HttpCode(200)
  @ApiJson(200, "ConnectionView", ConnectionViewSchema, "Check the WhatsApp number again (after a template is approved)")
  @ApiProblems(404)
  checkWhatsApp(@Auth() auth: AuthContext) {
    return this.whatsapp.recheck(auth);
  }

  @Get("confirmation/queue")
  @Roles("owner", "admin", "ops_manager", "agent")
  @ApiJson(200, "CallQueue", CallQueueSchema, "Orders waiting for the team's call: due now, mine, retrying later, unreachable")
  queueSummary(@Auth() auth: AuthContext) {
    return this.queue.summary(auth);
  }

  @Post("confirmation/queue/next")
  @Roles("owner", "admin", "ops_manager", "agent")
  @HttpCode(200)
  @ApiJson(200, "CallQueueNext", CallQueueNextSchema, "The next order to call, claimed for the caller (mine first, retries due before new, the unreachable last)")
  queueNext(@Auth() auth: AuthContext) {
    return this.queue.next(auth);
  }

  @Get("confirmation/summary")
  @Roles("owner", "admin", "ops_manager")
  @ApiQueryZod(ConfirmationSummaryQuerySchema)
  @ApiJson(200, "ConfirmationSummary", ConfirmationSummarySchema, "How confirmation went: rate, time to confirm, by route and by channel (counts only)")
  results(@Auth() auth: AuthContext, @Query(new ZodPipe(ConfirmationSummaryQuerySchema)) q: z.output<typeof ConfirmationSummaryQuerySchema>) {
    return this.analytics.summary(auth.tenant!.id, q.days);
  }

  @Get("settings/confirmation")
  @Roles("owner", "admin", "ops_manager")
  @ApiJson(200, "ConfirmationSettingsView", ConfirmationSettingsViewSchema, "The store's cascade, waits, calling hours, and which channels are connected")
  settings(@Auth() auth: AuthContext) {
    return this.confirmations.getSettings(auth.tenant!.id);
  }

  @Post("settings/confirmation/preview")
  @HttpCode(200)
  @Roles("owner", "admin", "ops_manager")
  @ApiJsonBody("ScriptPreviewRequest", ScriptPreviewRequestSchema)
  @ApiJson(200, "ScriptPreview", ScriptPreviewSchema, "E6-5: the script filled from an order (or a sample): each reply by the button it answers, and the call script")
  @ApiProblems(404, 422)
  preview(@Auth() auth: AuthContext, @Body(new ZodPipe(ScriptPreviewRequestSchema)) body: z.output<typeof ScriptPreviewRequestSchema>) {
    return this.confirmations.previewScript(auth.tenant!.id, body.script, body.orderId);
  }

  @Put("settings/confirmation")
  @Roles("owner", "admin", "ops_manager")
  @ApiJsonBody("ConfirmationSettings", ConfirmationSettingsSchema)
  @ApiJson(200, "ConfirmationSettingsView", ConfirmationSettingsViewSchema, "Saved; applies to orders that start confirmation from now on")
  saveSettings(@Auth() auth: AuthContext, @Body(new ZodPipe(ConfirmationSettingsSchema)) body: ConfirmationSettings) {
    return this.confirmations.putSettings(auth, body);
  }
}

/**
 * The customer's confirm link (E6-7): no sign-in, the signed token is the key. Answers with the
 * order only (store, number, items, amounts, city, first name), never phone or address.
 * Rate-limited per IP here (public routes skip the guard's limit), never cached or replayed.
 */
@ApiTags("confirmation")
@Controller("public/confirm")
@Public()
export class PublicConfirmationController {
  constructor(@Inject(ConfirmationService) private readonly confirmations: ConfirmationService, @Inject(RateLimiter) private readonly limits: RateLimiter) {}

  @Get(":token")
  @Header("Cache-Control", "no-store")
  @Header("X-Robots-Tag", "noindex")
  @ApiJson(200, "PublicConfirmation", PublicConfirmationSchema, "The order behind a confirm link")
  @ApiProblems(404)
  view(@Param("token") token: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.limits.checkIp(req.ip, res);
    return this.confirmations.view(token);
  }

  @Post(":token")
  @HttpCode(200)
  @NoIdempotency()
  @Header("Cache-Control", "no-store")
  @ApiJsonBody("PublicAnswer", PublicAnswerSchema)
  @ApiJson(200, "PublicConfirmation", PublicConfirmationSchema, "Answered: the order as it is now")
  @ApiProblems(404, 409, 410)
  answer(@Param("token") token: string, @Body(new ZodPipe(PublicAnswerSchema)) body: z.output<typeof PublicAnswerSchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.limits.checkIp(req.ip, res);
    return this.confirmations.answerByLink(token, body);
  }
}

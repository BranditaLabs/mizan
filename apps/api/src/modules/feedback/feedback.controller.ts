import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Res, UseGuards, UseInterceptors } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { z } from "zod";
import { Auth, NoSupport, NoTenant } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { ApiJson, ApiJsonBody, ApiProblems, ApiQueryZod } from "../../platform/http/api-schema.js";
import type { HttpReply as Response } from "../../platform/http/http.types.js";
import { ProblemError } from "../../platform/http/problem.js";
import { TokenBuckets } from "../../platform/http/rate-limit.js";
import { ZodPipe } from "../../platform/http/zod.pipe.js";
import { Reader } from "../reports/reader.js";
import { StaffAuditInterceptor } from "../staff/staff-audit.interceptor.js";
import { PlatformGuard } from "../staff/staff.guard.js";
import { FeedbackCreatedSchema, FeedbackItemSchema, FeedbackPageSchema, FeedbackQuerySchema, SendFeedbackSchema, UpdateFeedbackSchema } from "./feedback.dto.js";
import { FeedbackService } from "./feedback.service.js";

/** Each person may send 10 in an hour (a token every 6 minutes, 10 at once): plenty to report, not enough to flood. */
export const FEEDBACK_PER_HOUR = 10;

/** In-app feedback (L1-8): any member of the store sends it from the screen they are on. */
@ApiTags("feedback")
@Controller("feedback")
export class FeedbackController {
  private readonly limits = new TokenBuckets(FEEDBACK_PER_HOUR / 60, FEEDBACK_PER_HOUR);

  constructor(@Inject(FeedbackService) private readonly feedback: FeedbackService) {}

  @Post()
  @NoSupport()
  @ApiJsonBody("SendFeedback", SendFeedbackSchema)
  @ApiJson(201, "FeedbackCreated", FeedbackCreatedSchema, "Sent to the Mizan team with the store, the person, the page (path only) and the language. 10 per person per hour.")
  @ApiProblems(422, 429)
  send(@Reader() auth: AuthContext, @Body(new ZodPipe(SendFeedbackSchema)) body: z.output<typeof SendFeedbackSchema>, @Res({ passthrough: true }) res: Response) {
    const r = this.limits.take(`feedback:${auth.user.id}`);
    res.header("RateLimit-Policy", `${r.limit};w=3600;policy="feedback"`);
    res.header("RateLimit", `limit=${r.limit}, remaining=${r.remaining}, reset=${r.resetS}`);
    if (!r.allowed) {
      res.header("Retry-After", String(Math.max(1, r.resetS)));
      throw new ProblemError(429, "rate_limited", `too much feedback at once; try again in ${Math.ceil(Math.max(1, r.resetS) / 60)} min`);
    }
    return this.feedback.send(auth, body);
  }
}

/** Feedback in the back office (L1-8): every staff member reads it and moves it along; each change is in the staff trail. */
@ApiTags("platform")
@Controller("platform/feedback")
@NoTenant()
@UseGuards(PlatformGuard)
@UseInterceptors(StaffAuditInterceptor)
export class PlatformFeedbackController {
  constructor(@Inject(FeedbackService) private readonly feedback: FeedbackService) {}

  @Get()
  @ApiQueryZod(FeedbackQuerySchema)
  @ApiJson(200, "PlatformFeedbackPage", FeedbackPageSchema, "Feedback from every store, newest first; ?status= to filter")
  @ApiProblems(403, 422)
  list(@Query(new ZodPipe(FeedbackQuerySchema)) q: z.output<typeof FeedbackQuerySchema>) {
    return this.feedback.list(q);
  }

  @Patch(":id")
  @ApiJsonBody("UpdateFeedback", UpdateFeedbackSchema)
  @ApiJson(200, "PlatformFeedback", FeedbackItemSchema, "New, seen or done; a change is a line in the staff trail")
  @ApiProblems(403, 404, 422)
  update(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string, @Body(new ZodPipe(UpdateFeedbackSchema)) body: z.output<typeof UpdateFeedbackSchema>) {
    return this.feedback.update(auth, id, body.status);
  }
}

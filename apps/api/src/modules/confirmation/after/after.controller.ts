import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AfterConfirmationSchema, type AfterConfirmation } from "@mizan/shared";
import { Auth, Can } from "../../../platform/auth/decorators.js";
import type { AuthContext } from "../../../platform/auth/auth.types.js";
import { ApiJson, ApiJsonBody, ApiProblems } from "../../../platform/http/api-schema.js";
import { ZodPipe } from "../../../platform/http/zod.pipe.js";
import { AfterConfirmationService } from "./after.service.js";
import { AfterConfirmationViewSchema, AfterReleaseSchema, AfterSkipSchema } from "./after.dto.js";

/** What happens after confirmation (E6-23a): the store's settings, and the team's hand on one order. */
@ApiTags("confirmation")
@Controller()
export class AfterConfirmationController {
  constructor(@Inject(AfterConfirmationService) private readonly after: AfterConfirmationService) {}

  @Get("settings/after-confirmation")
  @Can("confirmation.manage")
  @ApiJson(200, "AfterConfirmationView", AfterConfirmationViewSchema, "What happens after each outcome (confirmed, changed, cancelled, no answer, opted out), the couriers and team to choose from, and a recommended starting point")
  view(@Auth() auth: AuthContext) {
    return this.after.view(auth.tenant!.id);
  }

  @Put("settings/after-confirmation")
  @Can("confirmation.manage")
  @ApiJsonBody("AfterConfirmation", AfterConfirmationSchema)
  @ApiJson(200, "AfterConfirmationView", AfterConfirmationViewSchema, "Saved and audited; applies to orders reaching each outcome from now on (a setting turned off also stops follow-ups already waiting)")
  @ApiProblems(422)
  save(@Auth() auth: AuthContext, @Body(new ZodPipe(AfterConfirmationSchema)) body: AfterConfirmation) {
    return this.after.put(auth, body);
  }

  @Post("orders/:id/after-confirmation/release")
  @HttpCode(200)
  @Can("shipping.ship")
  @ApiJson(200, "AfterRelease", AfterReleaseSchema, "Release now: the change window ends (or a hold because the customer wrote), and an automatic booking runs at once with all its checks; audited")
  @ApiProblems(404)
  release(@Auth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.after.release(auth, id);
  }

  @Post("orders/:id/after-confirmation/skip")
  @HttpCode(200)
  @Can("shipping.ship")
  @ApiJson(200, "AfterSkip", AfterSkipSchema, "Book by hand: this order will not be booked automatically; audited")
  @ApiProblems(404)
  skip(@Auth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.after.skipAutoBook(auth, id);
  }
}

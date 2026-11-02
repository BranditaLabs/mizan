import { Body, Controller, Get, Inject, Patch } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Auth, Roles } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { ApiJson, ApiJsonBody } from "../../platform/http/api-schema.js";
import { ZodPipe } from "../../platform/http/zod.pipe.js";
import { OnboardingSchema, UpdateOnboardingSchema, type UpdateOnboardingBody } from "./onboarding.dto.js";
import { OnboardingService } from "./onboarding.service.js";

/** Store setup for owners and admins (E4-5). */
@ApiTags("platform")
@Controller("onboarding")
@Roles("owner", "admin")
export class OnboardingController {
  constructor(@Inject(OnboardingService) private readonly onboarding: OnboardingService) {}

  @Get()
  @ApiJson(200, "Onboarding", OnboardingSchema, "Setup steps, milestones and time-to-first-value")
  get(@Auth() auth: AuthContext) {
    return this.onboarding.get(auth.tenant!.id);
  }

  @Patch()
  @ApiJsonBody("UpdateOnboarding", UpdateOnboardingSchema)
  @ApiJson(200, "Onboarding", OnboardingSchema, "The setup after the change")
  update(@Auth() auth: AuthContext, @Body(new ZodPipe(UpdateOnboardingSchema)) body: UpdateOnboardingBody) {
    return this.onboarding.update(auth, body);
  }
}

import { Controller, Get, Inject } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { Auth, NoTenant } from "../../platform/auth/decorators.js";
import { AuthService, type MembershipView } from "../../platform/auth/auth.service.js";
import type { AuthContext, AuthUser } from "../../platform/auth/auth.types.js";

export interface MeResponse {
  user: AuthUser & { emailVerified: boolean; mfa: boolean };
  memberships: MembershipView[];
}

/** GET /v1/me — who am I, and which stores can I open (tenant switcher). */
@ApiTags("platform")
@Controller("me")
export class MeController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Get()
  @NoTenant()
  @ApiOkResponse({ description: "The signed-in user and their store memberships." })
  async me(@Auth() auth: AuthContext): Promise<MeResponse> {
    return {
      user: { ...auth.user, emailVerified: auth.identity.emailVerified, mfa: Boolean(auth.identity.secondFactor) },
      memberships: await this.auth.memberships(auth.user.id),
    };
  }
}

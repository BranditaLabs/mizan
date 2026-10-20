import { Controller, Get, Inject } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { Auth, NoTenant } from "../../platform/auth/decorators.js";
import { AuthService, type MembershipView } from "../../platform/auth/auth.service.js";
import type { MyInvitationView } from "../members/members.dto.js";
import { MembersService } from "../members/members.service.js";
import type { AuthContext, AuthUser } from "../../platform/auth/auth.types.js";

export interface MeResponse {
  user: AuthUser & { emailVerified: boolean; mfa: boolean };
  memberships: MembershipView[];
  /** Pending invitations addressed to my verified email or phone. */
  invitations: MyInvitationView[];
}

/** GET /v1/me — who am I, and which stores can I open (tenant switcher). */
@ApiTags("platform")
@Controller("me")
export class MeController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(MembersService) private readonly members: MembersService,
  ) {}

  @Get()
  @NoTenant()
  @ApiOkResponse({ description: "The signed-in user and their store memberships." })
  async me(@Auth() auth: AuthContext): Promise<MeResponse> {
    return {
      user: { ...auth.user, emailVerified: auth.identity.emailVerified, mfa: Boolean(auth.identity.secondFactor) },
      memberships: await this.auth.memberships(auth.user.id),
      invitations: await this.members.mine(auth),
    };
  }
}

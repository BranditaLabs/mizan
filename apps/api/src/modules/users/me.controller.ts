import { Controller, Get, Inject } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ApiJson } from "../../platform/http/api-schema.js";
import { MeSchema, type MeResponse } from "./me.dto.js";
import { Auth, NoTenant } from "../../platform/auth/decorators.js";
import { AuthService } from "../../platform/auth/auth.service.js";
import { MembersService } from "../members/members.service.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";


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
  @ApiJson(200, "Me", MeSchema, "The signed-in user, their stores and invitations waiting for them")
  async me(@Auth() auth: AuthContext): Promise<MeResponse> {
    return {
      user: { ...auth.user, emailVerified: auth.identity.emailVerified, mfa: Boolean(auth.identity.secondFactor) },
      memberships: await this.auth.memberships(auth.user.id),
      invitations: await this.members.mine(auth),
    };
  }
}

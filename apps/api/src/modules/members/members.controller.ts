import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ApiJson, ApiJsonBody, ApiNoContent, ApiProblems } from "../../platform/http/api-schema.js";
import { Auth, NoSupport, NoTenant, Roles } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { ZodPipe } from "../../platform/http/zod.pipe.js";
import {
  AcceptedInvitationSchema, InvitationViewSchema, InviteSchema, MemberViewSchema, TeamSchema, UpdateMemberSchema, type InviteBody, type UpdateMemberBody,
} from "./members.dto.js";
import { MembersService } from "./members.service.js";

/** Team management (owner, admin) and invitation acceptance (any signed-in user). */
@ApiTags("platform")
@Controller()
export class MembersController {
  constructor(@Inject(MembersService) private readonly members: MembersService) {}

  @Get("members")
  @Roles("owner", "admin")
  @ApiJson(200, "Team", TeamSchema, "Members and pending invitations")
  list(@Auth() auth: AuthContext) {
    return this.members.list(auth.tenant!.id);
  }

  @Post("members/invite")
  @NoSupport()
  @Roles("owner", "admin")
  @HttpCode(201)
  @ApiJsonBody("Invite", InviteSchema)
  @ApiJson(201, "Invitation", InvitationViewSchema, "The invitation, with a link to share")
  @ApiProblems(409)
  invite(@Auth() auth: AuthContext, @Body(new ZodPipe(InviteSchema)) body: InviteBody) {
    return this.members.invite(auth, body);
  }

  @Patch("members/:userId")
  @NoSupport()
  @Roles("owner", "admin")
  @ApiJsonBody("UpdateMember", UpdateMemberSchema)
  @ApiJson(200, "Member", MemberViewSchema, "The member after the change")
  @ApiProblems(404, 409)
  update(@Auth() auth: AuthContext, @Param("userId") userId: string, @Body(new ZodPipe(UpdateMemberSchema)) body: UpdateMemberBody) {
    return this.members.update(auth, userId, body);
  }

  @Delete("members/:userId")
  @NoSupport()
  @Roles("owner", "admin")
  @HttpCode(204)
  @ApiNoContent("Removed from the store")
  @ApiProblems(404, 409)
  async remove(@Auth() auth: AuthContext, @Param("userId") userId: string): Promise<void> {
    await this.members.remove(auth, userId);
  }

  @Delete("invitations/:id")
  @NoSupport()
  @Roles("owner", "admin")
  @HttpCode(204)
  @ApiNoContent("Invitation revoked")
  @ApiProblems(404)
  async revoke(@Auth() auth: AuthContext, @Param("id") id: string): Promise<void> {
    await this.members.revoke(auth, id);
  }

  @Post("invitations/:id/accept")
  @NoTenant()
  @HttpCode(200)
  @ApiJson(200, "AcceptedInvitation", AcceptedInvitationSchema, "Joined the store")
  @ApiProblems(404)
  accept(@Auth() auth: AuthContext, @Param("id") id: string) {
    return this.members.accept(auth, id);
  }
}

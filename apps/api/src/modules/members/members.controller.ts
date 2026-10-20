import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Auth, NoTenant, Roles } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { ZodPipe } from "../../platform/http/zod.pipe.js";
import { InviteSchema, UpdateMemberSchema, type InviteBody, type UpdateMemberBody } from "./members.dto.js";
import { MembersService } from "./members.service.js";

/** Team management (owner, admin) and invitation acceptance (any signed-in user). */
@ApiTags("platform")
@Controller()
export class MembersController {
  constructor(@Inject(MembersService) private readonly members: MembersService) {}

  @Get("members")
  @Roles("owner", "admin")
  list(@Auth() auth: AuthContext) {
    return this.members.list(auth.tenant!.id);
  }

  @Post("members/invite")
  @Roles("owner", "admin")
  @HttpCode(201)
  invite(@Auth() auth: AuthContext, @Body(new ZodPipe(InviteSchema)) body: InviteBody) {
    return this.members.invite(auth, body);
  }

  @Patch("members/:userId")
  @Roles("owner", "admin")
  update(@Auth() auth: AuthContext, @Param("userId") userId: string, @Body(new ZodPipe(UpdateMemberSchema)) body: UpdateMemberBody) {
    return this.members.update(auth, userId, body);
  }

  @Delete("members/:userId")
  @Roles("owner", "admin")
  @HttpCode(204)
  async remove(@Auth() auth: AuthContext, @Param("userId") userId: string): Promise<void> {
    await this.members.remove(auth, userId);
  }

  @Delete("invitations/:id")
  @Roles("owner", "admin")
  @HttpCode(204)
  async revoke(@Auth() auth: AuthContext, @Param("id") id: string): Promise<void> {
    await this.members.revoke(auth, id);
  }

  @Post("invitations/:id/accept")
  @NoTenant()
  @HttpCode(200)
  accept(@Auth() auth: AuthContext, @Param("id") id: string) {
    return this.members.accept(auth, id);
  }
}

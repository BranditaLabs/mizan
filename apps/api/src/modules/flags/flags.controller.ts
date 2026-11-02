import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Query, UseGuards, UseInterceptors } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { z } from "zod";
import { Auth, NoTenant } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { ApiJson, ApiJsonBody, ApiNoContent, ApiProblems, ApiQueryZod } from "../../platform/http/api-schema.js";
import { ZodPipe } from "../../platform/http/zod.pipe.js";
import { StaffAuditInterceptor } from "../staff/staff-audit.interceptor.js";
import { PlatformGuard, StaffRoles } from "../staff/staff.guard.js";
import {
  AnnouncementSchema, AnnouncementsQuerySchema, AnnouncementsSchema, CreateAnnouncementSchema, FlagKeyParam, FlagSchema, FlagsSchema,
  PutFlagSchema, PutStoreFlagSchema, StoreAnnouncementsSchema, StoreFlagsSchema,
} from "./flags.dto.js";
import { FlagsService } from "./flags.service.js";

/** Back office (A-6): flags are for super admins and engineers; announcements for super admins and support. */
@ApiTags("platform")
@Controller("platform")
@NoTenant()
@UseGuards(PlatformGuard)
@UseInterceptors(StaffAuditInterceptor)
export class PlatformFlagsController {
  constructor(@Inject(FlagsService) private readonly flags: FlagsService) {}

  @Get("flags")
  @StaffRoles("super_admin", "engineer", "support")
  @ApiJson(200, "PlatformFlags", FlagsSchema, "Every flag, for everyone and per store")
  @ApiProblems(403)
  list() {
    return this.flags.list();
  }

  @Put("flags/:key")
  @StaffRoles("super_admin", "engineer")
  @ApiJsonBody("PutFlag", PutFlagSchema)
  @ApiJson(200, "PlatformFlag", FlagSchema, "Created, or changed for every store without its own setting")
  @ApiProblems(403, 422)
  put(@Auth() auth: AuthContext, @Param("key", new ZodPipe(FlagKeyParam)) key: string, @Body(new ZodPipe(PutFlagSchema)) body: z.output<typeof PutFlagSchema>) {
    return this.flags.put(auth, key, body);
  }

  @Delete("flags/:key")
  @HttpCode(204)
  @StaffRoles("super_admin", "engineer")
  @ApiNoContent("Gone for every store, with its store settings; code asking for it reads it as off")
  @ApiProblems(403, 404, 422)
  async remove(@Param("key", new ZodPipe(FlagKeyParam)) key: string) {
    await this.flags.remove(key);
  }

  @Put("flags/:key/stores/:storeId")
  @StaffRoles("super_admin", "engineer")
  @ApiJsonBody("PutStoreFlag", PutStoreFlagSchema)
  @ApiJson(200, "PlatformFlag", FlagSchema, "The store's own setting; it wins over everyone's")
  @ApiProblems(403, 404, 422)
  putStore(@Auth() auth: AuthContext, @Param("key", new ZodPipe(FlagKeyParam)) key: string, @Param("storeId", new ParseUUIDPipe()) storeId: string, @Body(new ZodPipe(PutStoreFlagSchema)) body: z.output<typeof PutStoreFlagSchema>) {
    return this.flags.putStore(auth, key, storeId, body.enabled);
  }

  @Delete("flags/:key/stores/:storeId")
  @StaffRoles("super_admin", "engineer")
  @ApiJson(200, "PlatformFlag", FlagSchema, "The store follows everyone's setting again")
  @ApiProblems(403, 404, 422)
  clearStore(@Auth() auth: AuthContext, @Param("key", new ZodPipe(FlagKeyParam)) key: string, @Param("storeId", new ParseUUIDPipe()) storeId: string) {
    return this.flags.putStore(auth, key, storeId, null);
  }

  @Get("announcements")
  @StaffRoles("super_admin", "support", "engineer")
  @ApiQueryZod(AnnouncementsQuerySchema)
  @ApiJson(200, "PlatformAnnouncements", AnnouncementsSchema, "Newest first; ?live=true for those not ended")
  @ApiProblems(403)
  announcements(@Query(new ZodPipe(AnnouncementsQuerySchema)) q: z.output<typeof AnnouncementsQuerySchema>) {
    return this.flags.announcements(q.live);
  }

  @Post("announcements")
  @StaffRoles("super_admin", "support")
  @ApiJsonBody("CreateAnnouncement", CreateAnnouncementSchema)
  @ApiJson(201, "PlatformAnnouncement", AnnouncementSchema, "Shown across the dashboard of the stores it targets, in Arabic and English, until endsAt")
  @ApiProblems(403, 422)
  announce(@Auth() auth: AuthContext, @Body(new ZodPipe(CreateAnnouncementSchema)) body: z.output<typeof CreateAnnouncementSchema>) {
    return this.flags.announce(auth, body);
  }

  @Post("announcements/:id/end")
  @HttpCode(200)
  @StaffRoles("super_admin", "support")
  @ApiJson(200, "PlatformAnnouncement", AnnouncementSchema, "Ended now (kept for the record)")
  @ApiProblems(403, 404)
  end(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.flags.endAnnouncement(id);
  }
}

/** What a store sees (A-6): its flags and the announcements meant for it. Any member. */
@ApiTags("platform")
@Controller()
export class StoreFlagsController {
  constructor(@Inject(FlagsService) private readonly flags: FlagsService) {}

  @Get("flags")
  @ApiJson(200, "StoreFlags", StoreFlagsSchema, "Every flag as it applies to this store (unknown keys are off)")
  async storeFlags(@Auth() auth: AuthContext) {
    return { flags: await this.flags.forStore(auth.tenant!.id) };
  }

  @Get("announcements")
  @ApiJson(200, "StoreAnnouncements", StoreAnnouncementsSchema, "Announcements from Mizan for this store right now")
  storeAnnouncements(@Auth() auth: AuthContext) {
    return this.flags.forReader(auth);
  }
}

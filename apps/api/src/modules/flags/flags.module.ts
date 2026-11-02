import { Global, Module } from "@nestjs/common";
import { StaffModule } from "../staff/staff.module.js";
import { PlatformFlagsController, StoreFlagsController } from "./flags.controller.js";
import { FlagsService } from "./flags.service.js";

/** Feature flags and announcements (A-6). Global: any module may ask FlagsService.isEnabled. */
@Global()
@Module({ imports: [StaffModule], controllers: [PlatformFlagsController, StoreFlagsController], providers: [FlagsService], exports: [FlagsService] })
export class FlagsModule {}

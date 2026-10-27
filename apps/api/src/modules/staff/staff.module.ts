import { Module } from "@nestjs/common";
import { StaffAuditInterceptor } from "./staff-audit.interceptor.js";
import { StaffController } from "./staff.controller.js";
import { PlatformGuard } from "./staff.guard.js";
import { StaffService } from "./staff.service.js";

/** E17 back office: staff identity, PlatformGuard and the staff trail (A-1); stores, support access and health follow (A-2…A-6). */
@Module({ controllers: [StaffController], providers: [StaffService, PlatformGuard, StaffAuditInterceptor], exports: [StaffService, PlatformGuard, StaffAuditInterceptor] })
export class StaffModule {}

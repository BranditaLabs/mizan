import { Module } from "@nestjs/common";
import { StaffAuditInterceptor } from "./staff-audit.interceptor.js";
import { StaffController } from "./staff.controller.js";
import { PlatformGuard } from "./staff.guard.js";
import { StaffService } from "./staff.service.js";
import { StaffSupportAccessController, StoreSupportAccessController } from "./support-access.controller.js";
import { SupportAccessService } from "./support-access.service.js";
import { StoresController } from "./stores.controller.js";
import { StoresService } from "./stores.service.js";
import { AuditModule } from "../../platform/audit/audit.module.js";

/** E17 back office: staff identity, PlatformGuard and the staff trail (A-1); stores (A-2); support access (A-3); health, users and flags follow (A-4…A-6). */
@Module({ imports: [AuditModule], controllers: [StaffController, StoresController, StaffSupportAccessController, StoreSupportAccessController], providers: [StaffService, StoresService, SupportAccessService, PlatformGuard, StaffAuditInterceptor], exports: [StaffService, PlatformGuard, StaffAuditInterceptor] })
export class StaffModule {}

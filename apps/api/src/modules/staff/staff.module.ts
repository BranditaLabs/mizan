import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";
import { HealthService } from "./health.service.js";
import { UsersController } from "./users.controller.js";
import { UsersService } from "./users.service.js";
import { StaffAuditInterceptor } from "./staff-audit.interceptor.js";
import { StaffController } from "./staff.controller.js";
import { PlatformGuard } from "./staff.guard.js";
import { StaffService } from "./staff.service.js";
import { StaffSupportAccessController, StoreSupportAccessController } from "./support-access.controller.js";
import { SupportAccessService } from "./support-access.service.js";
import { StoresController } from "./stores.controller.js";
import { StoresService } from "./stores.service.js";
import { AuditModule } from "../../platform/audit/audit.module.js";

/** E17 back office: staff identity, PlatformGuard and the staff trail (A-1); stores (A-2); support access (A-3); system health (A-4); users (A-5); flags follow (A-6). */
@Module({ imports: [AuditModule], controllers: [StaffController, StoresController, StaffSupportAccessController, StoreSupportAccessController, HealthController, UsersController], providers: [StaffService, HealthService, UsersService, StoresService, SupportAccessService, PlatformGuard, StaffAuditInterceptor], exports: [StaffService, PlatformGuard, StaffAuditInterceptor] })
export class StaffModule {}

import { Module } from "@nestjs/common";
import { AuditLogController } from "./audit-log.controller.js";

@Module({ controllers: [AuditLogController] })
export class AuditLogModule {}

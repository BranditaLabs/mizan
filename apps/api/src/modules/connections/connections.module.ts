import { Module } from "@nestjs/common";
import { IntegrationsAdminController } from "./integrations-admin.controller.js";

/** Store, courier and other provider connections. Today: integration ops; connect flows land in E3. */
@Module({ controllers: [IntegrationsAdminController] })
export class ConnectionsModule {}

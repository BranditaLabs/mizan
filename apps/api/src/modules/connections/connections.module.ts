import { Module } from "@nestjs/common";
import { IntegrationsAdminController } from "./integrations-admin.controller.js";
import { ShopifyConnectController } from "./shopify/shopify-connect.controller.js";
import { ShopifyInstallService } from "./shopify/shopify-install.service.js";

/** Store, courier and other provider connections: connect flows (E3) and integration ops (E2-5). */
@Module({ controllers: [IntegrationsAdminController, ShopifyConnectController], providers: [ShopifyInstallService] })
export class ConnectionsModule {}

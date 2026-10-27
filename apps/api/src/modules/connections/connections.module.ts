import { Module } from "@nestjs/common";
import { BostaConnectService } from "./bosta/bosta-connect.service.js";
import { ConnectionsController } from "./bosta/bosta-connect.controller.js";
import { IntegrationsAdminController } from "./integrations-admin.controller.js";
import { ShopifyConnectController } from "./shopify/shopify-connect.controller.js";
import { ShopifyInstallService } from "./shopify/shopify-install.service.js";
import { StoreSyncController, StoreSyncService } from "./shopify/store-sync.js";

/** Store, courier and other provider connections: connect flows (E3) and integration ops (E2-5). */
@Module({ controllers: [ConnectionsController, IntegrationsAdminController, ShopifyConnectController, StoreSyncController], providers: [ShopifyInstallService, BostaConnectService, StoreSyncService] })
export class ConnectionsModule {}

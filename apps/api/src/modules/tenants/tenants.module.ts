import { Module } from "@nestjs/common";
import { TenantsController } from "./tenants.controller.js";
import { TenantsService } from "./tenants.service.js";
import { BillingModule } from "../billing/billing.module.js";

@Module({ imports: [BillingModule], controllers: [TenantsController], providers: [TenantsService] })
export class TenantsModule {}

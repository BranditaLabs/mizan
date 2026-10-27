import { Module, type DynamicModule, type Type } from "@nestjs/common";
import type { DestinationStream } from "pino";
import { AuthModule } from "./platform/auth/auth.module.js";
import type { TokenVerifier } from "./platform/auth/token-verifier.js";
import { MembersModule } from "./modules/members/members.module.js";
import { TenantsModule } from "./modules/tenants/tenants.module.js";
import { OrdersModule } from "./modules/orders/orders.module.js";
import { CatalogModule } from "./modules/catalog/catalog.module.js";
import { OnboardingModule } from "./modules/onboarding/onboarding.module.js";
import { ProfitModule } from "./modules/profit/profit.module.js";
import { StockModule } from "./modules/stock/stock.module.js";
import { PaymentsModule } from "./modules/payments/payments.module.js";
import { TicketsModule } from "./modules/tickets/tickets.module.js";
import { ShippingModule } from "./modules/shipping/shipping.module.js";
import { StaffModule } from "./modules/staff/staff.module.js";
import { ReturnsModule } from "./modules/returns/returns.module.js";
import { BillingModule } from "./modules/billing/billing.module.js";
import { ReportsModule } from "./modules/reports/reports.module.js";
import { OpsModule } from "./modules/ops/ops.module.js";
import { AutomationsModule } from "./modules/automations/automations.module.js";
import { ConfirmationModule } from "./modules/confirmation/confirmation.module.js";
import { ConnectionsModule } from "./modules/connections/connections.module.js";
import { UsersModule } from "./modules/users/users.module.js";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { IdempotencyInterceptor } from "./platform/http/idempotency.interceptor.js";
import type { AppConfig } from "./platform/config.js";
import { ConfigModule } from "./platform/config.module.js";
import { DatabaseModule } from "./platform/db/database.module.js";
import { EventsModule } from "./platform/events/events.module.js";
import { AuditModule } from "./platform/audit/audit.module.js";
import { MaintenanceModule } from "./platform/maintenance/maintenance.module.js";
import { MetricsModule } from "./platform/metrics/metrics.module.js";
import { SecretsModule } from "./platform/secrets/secrets.module.js";
import type { KeyWrapper } from "./platform/secrets/key-wrapper.js";
import { IntegrationsModule } from "./integrations/integrations.module.js";
import type { RuntimeFactory } from "./integrations/engine-registry.js";
import { PrivacyModule } from "./modules/privacy/privacy.module.js";
import { AuditLogModule } from "./modules/audit/audit-log.module.js";
import { ProblemFilter } from "./platform/http/problem.filter.js";
import { LoggingModule } from "./platform/logging/logger.module.js";
import { HealthModule } from "./modules/health/health.module.js";

export interface AppOptions {
  /** Where logs go (default stdout). */
  logDestination?: DestinationStream;
  /** Replaces the Firebase token verifier (tests). */
  tokenVerifier?: TokenVerifier;
  /** Replaces the KMS key wrapper (tests). */
  keyWrapper?: KeyWrapper;
  /** Engine runtime per tenant (tests: fake providers). */
  engineRuntime?: RuntimeFactory;
  /** Extra modules (tests). */
  modules?: Array<Type | DynamicModule>;
}

@Module({})
export class AppModule {
  static forRoot(config: AppConfig, options: AppOptions = {}): DynamicModule {
    return {
      module: AppModule,
      imports: [ConfigModule.forRoot(config), LoggingModule.forRoot(options.logDestination), DatabaseModule.forRoot(), EventsModule, AuditModule, MaintenanceModule, MetricsModule, SecretsModule.forRoot(options.keyWrapper), PaymentsModule, OrdersModule, OnboardingModule, CatalogModule, StockModule, TicketsModule, ReturnsModule, ShippingModule, StaffModule, BillingModule, ReportsModule, OpsModule, AutomationsModule, ProfitModule, ConfirmationModule, IntegrationsModule.forRoot(options.engineRuntime), AuthModule.forRoot(options.tokenVerifier), HealthModule, UsersModule, TenantsModule, MembersModule, AuditLogModule, ConnectionsModule, PrivacyModule, ...(options.modules ?? [])],
      providers: [{ provide: APP_FILTER, useClass: ProblemFilter }, { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor }],
    };
  }
}

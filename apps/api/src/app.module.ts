import { Module, type DynamicModule, type Type } from "@nestjs/common";
import type { DestinationStream } from "pino";
import { AuthModule } from "./platform/auth/auth.module.js";
import type { TokenVerifier } from "./platform/auth/token-verifier.js";
import { MembersModule } from "./modules/members/members.module.js";
import { TenantsModule } from "./modules/tenants/tenants.module.js";
import { UsersModule } from "./modules/users/users.module.js";
import { APP_FILTER } from "@nestjs/core";
import type { AppConfig } from "./platform/config.js";
import { ConfigModule } from "./platform/config.module.js";
import { DatabaseModule } from "./platform/db/database.module.js";
import { EventsModule } from "./platform/events/events.module.js";
import { ProblemFilter } from "./platform/http/problem.filter.js";
import { LoggingModule } from "./platform/logging/logger.module.js";
import { HealthModule } from "./modules/health/health.module.js";

export interface AppOptions {
  /** Where logs go (default stdout). */
  logDestination?: DestinationStream;
  /** Replaces the Firebase token verifier (tests). */
  tokenVerifier?: TokenVerifier;
  /** Extra modules (tests). */
  modules?: Array<Type | DynamicModule>;
}

@Module({})
export class AppModule {
  static forRoot(config: AppConfig, options: AppOptions = {}): DynamicModule {
    return {
      module: AppModule,
      imports: [ConfigModule.forRoot(config), LoggingModule.forRoot(options.logDestination), DatabaseModule.forRoot(), EventsModule, AuthModule.forRoot(options.tokenVerifier), HealthModule, UsersModule, TenantsModule, MembersModule, ...(options.modules ?? [])],
      providers: [{ provide: APP_FILTER, useClass: ProblemFilter }],
    };
  }
}

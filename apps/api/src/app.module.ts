import { Module, type DynamicModule, type Type } from "@nestjs/common";
import type { DestinationStream } from "pino";
import { APP_FILTER } from "@nestjs/core";
import type { AppConfig } from "./platform/config.js";
import { ConfigModule } from "./platform/config.module.js";
import { DatabaseModule } from "./platform/db/database.module.js";
import { ProblemFilter } from "./platform/http/problem.filter.js";
import { LoggingModule } from "./platform/logging/logger.module.js";
import { HealthModule } from "./modules/health/health.module.js";

export interface AppOptions {
  /** Where logs go (default stdout). */
  logDestination?: DestinationStream;
  /** Extra modules (tests). */
  modules?: Array<Type | DynamicModule>;
}

@Module({})
export class AppModule {
  static forRoot(config: AppConfig, options: AppOptions = {}): DynamicModule {
    return {
      module: AppModule,
      imports: [ConfigModule.forRoot(config), LoggingModule.forRoot(options.logDestination), DatabaseModule.forRoot(), HealthModule, ...(options.modules ?? [])],
      providers: [{ provide: APP_FILTER, useClass: ProblemFilter }],
    };
  }
}

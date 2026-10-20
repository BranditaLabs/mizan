import { Global, Inject, Logger, Module, type DynamicModule, type OnApplicationShutdown } from "@nestjs/common";
import { createPgDb, createPglite, createPgliteDb, migrate, pgliteMigrationClient } from "@mizan/db";
import { APP_CONFIG, type AppConfig } from "../config.js";
import { Database } from "./database.js";

/**
 * Opens the database once per process.
 * - postgres://… → pooled node-postgres (migrations run separately: `mizan-db migrate`).
 * - unset / pglite:<dir> (development, test) → PGlite in-process, migrated at boot.
 */
export async function openDatabase(config: AppConfig, logger = new Logger("Database")): Promise<Database> {
  const url = config.DATABASE_URL;
  if (url?.startsWith("postgres")) {
    return new Database(createPgDb(url, {
      max: config.DATABASE_POOL_MAX,
      onIdleError: (err) => logger.warn({ err }, "idle database connection lost; the pool replaces it"),
    }));
  }
  const dir = url?.slice("pglite:".length) || undefined;
  const pglite = await createPglite(dir);
  const { applied } = await migrate(pgliteMigrationClient(pglite));
  logger.log(`PGlite ${dir ?? "in memory"}: ${applied.length} migrations applied`);
  return new Database(createPgliteDb(pglite), () => pglite.close());
}

@Global()
@Module({})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(Database) private readonly db: Database) {}

  static forRoot(): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [{ provide: Database, inject: [APP_CONFIG], useFactory: (config: AppConfig) => openDatabase(config) }],
      exports: [Database],
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.db.close();
  }
}

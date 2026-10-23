import { randomBytes } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { defaultRuntime, MizanEngine, SqlStore, type EngineOptions, type OfferOutcome, type Runtime } from "@mizan/engine";
import { tenantQueryClient } from "@mizan/db";
import { APP_CONFIG, type AppConfig } from "../platform/config.js";
import { Database } from "../platform/db/database.js";
import { ConnectionResolver, type ResolvedConnections } from "./connection-resolver.js";
import { ProductProjector } from "../modules/catalog/product-projector.js";
import { CourierAccess } from "./courier-access.js";
import { OrderProjector } from "../modules/orders/order-projector.js";

/** Builds the engine runtime for a tenant (tests inject fake providers here). */
/** Runtime for a tenant's engine; also called without connections for one-off provider calls (OAuth code exchange). */
export type RuntimeFactory = (tenantId: string, connections?: ResolvedConnections) => Runtime;
export const ENGINE_RUNTIME = Symbol("ENGINE_RUNTIME");

/** Listener for engine events (order.ingested, shipment.status …); E2-3 maps them to domain events. */
export type EngineEventSink = (tenantId: string, event: string, data: Record<string, unknown>) => void;
export const ENGINE_EVENT_SINK = Symbol("ENGINE_EVENT_SINK");

/** Where the engine's answer for an accepted offer goes (E6-13); M2's OffersService, bound by token to keep the import graph acyclic. */
export interface OfferResultSink {
  recordResult(tenantId: string, offerId: string, result: OfferOutcome): Promise<void>;
}
export const OFFER_RESULTS = Symbol("OFFER_RESULTS");

export interface TenantEngine {
  tenantId: string;
  engine: MizanEngine;
  store: SqlStore;
  connections: ResolvedConnections;
  builtAt: number;
}

/** Engines are rebuilt after this long, so rotated credentials and changed connections are picked up. */
export const ENGINE_TTL_MS = 10 * 60_000;

/** Engine log lines go through Nest's logger (pino, PII-redacted). */
export function engineLogger(tenantId: string): Runtime["logger"] {
  const log = new Logger("Engine");
  return {
    log(level, msg, data) {
      const entry = { tenantId, ...data };
      if (level === "error") log.error(entry, msg);
      else if (level === "warn") log.warn(entry, msg);
      else if (level === "debug") log.debug(entry, msg);
      else log.log(entry, msg);
    },
  };
}

/**
 * One MizanEngine per tenant, built from that tenant's connections and decrypted
 * credentials. Each engine owns its connectors, so circuit breakers and rate
 * buckets are per connection: one store being throttled or down never slows another.
 * Its SqlStore runs every query under the tenant's RLS context.
 */
@Injectable()
export class EngineRegistry {
  private readonly cache = new Map<string, TenantEngine>();
  private readonly building = new Map<string, Promise<TenantEngine>>();

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(ConnectionResolver) private readonly resolver: ConnectionResolver,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(ENGINE_RUNTIME) private readonly runtime: RuntimeFactory,
    @Inject(ENGINE_EVENT_SINK) private readonly sink: EngineEventSink,
    @Inject(OrderProjector) private readonly orders: OrderProjector,
    @Inject(ProductProjector) private readonly products: ProductProjector,
    @Inject(CourierAccess) private readonly courierAccess: CourierAccess,
    @Inject(ModuleRef) private readonly moduleRef: ModuleRef,
  ) {}

  /** M2 depends on the engine and the engine reports back to M2: resolved when first needed. */
  private get offerResults(): OfferResultSink | undefined {
    try { return this.moduleRef.get<OfferResultSink>(OFFER_RESULTS, { strict: false }); } catch { return undefined; }
  }

  async get(tenantId: string): Promise<TenantEngine> {
    const hit = this.cache.get(tenantId);
    if (hit && Date.now() - hit.builtAt < ENGINE_TTL_MS) return hit;
    const pending = this.building.get(tenantId);
    if (pending) return pending;
    const build = this.build(tenantId).finally(() => this.building.delete(tenantId));
    this.building.set(tenantId, build);
    return build;
  }

  /** Drop a tenant's engine (connection added, removed or rotated). */
  invalidate(tenantId: string): void {
    this.cache.delete(tenantId);
  }

  /** Engines built on this instance (metrics). */
  all(): TenantEngine[] {
    return [...this.cache.values()];
  }

  cached(tenantId: string): TenantEngine | undefined {
    return this.cache.get(tenantId);
  }

  private async build(tenantId: string): Promise<TenantEngine> {
    const c = await this.resolver.resolve(tenantId);
    const connections: Record<string, string> = { shopify: c.shopify.connectionId };
    if (c.bosta) connections.bosta = c.bosta.connectionId;
    const store = new SqlStore(tenantQueryClient(this.db.kysely, tenantId), { tenantId, connections });

    const bostaConfig = c.bosta?.config ?? {};
    const options: EngineOptions = {
      shopify: {
        shop: c.shopify.shop,
        accessToken: c.shopify.accessToken.reveal(),
        apiVersion: this.config.SHOPIFY_API_VERSION,
        clientSecret: this.config.SHOPIFY_API_SECRET ?? "",
        webhookUrl: new URL(`/webhooks/shopify/${c.shopify.connectionId}`, this.config.PUBLIC_URL).toString(),
      },
      // Without a Bosta connection, courier jobs fail as `auth` and surface as connection.needs_attention.
      bosta: {
        apiKey: c.bosta?.apiKey.reveal() ?? "",
        webhookSecret: c.bosta?.webhookToken.reveal() ?? randomBytes(24).toString("hex"),
        ...(this.config.BOSTA_BASE_URL ? { baseUrl: this.config.BOSTA_BASE_URL } : {}),
        ...(c.bosta ? { webhookUrl: new URL(`/webhooks/bosta/${c.bosta.connectionId}`, this.config.PUBLIC_URL).toString() } : {}),
        ...(this.config.BOSTA_TRACKING_URL_TEMPLATE ? { trackingUrlTemplate: this.config.BOSTA_TRACKING_URL_TEMPLATE } : {}),
        ...(typeof bostaConfig.cityField === "string" ? { cityField: bostaConfig.cityField as "city" | "cityCode" | "cityId" } : {}),
      },
      learned: {
        shopify: c.shopify.learned,
        ...(c.bosta ? { bosta: c.bosta.learned } : {}),
      },
      hooks: {
        // Every order the engine ingests lands in Mizan's orders table before the job completes.
        onOrder: async (order) => {
          await this.orders.project(tenantId, c.shopify.connectionId, order);
        },
        // Every product the engine reads lands in Mizan's catalogue (costs stay Mizan's).
        onProduct: async (product) => {
          await this.products.project(tenantId, c.shopify.connectionId, product);
        },
        onAccessChecked: async (provider, result) => {
          if (c.bosta) await this.courierAccess.checked(tenantId, c.bosta.connectionId, provider, result);
        },
        onAwaitingPayment: async (order, reason) => {
          await this.orders.awaitingPayment(tenantId, c.shopify.connectionId, order, reason);
        },
        // An accepted offer is in the Shopify order now, or could not be added (E6-13).
        onOfferResult: async (offerId, result) => {
          await this.offerResults?.recordResult(tenantId, offerId, result);
        },
        // Learned status codes, city aliases and query variants outlive the engine: they belong to the connection.
        onLearned: async (provider, state) => {
          const connectionId = provider === "shopify" ? c.shopify.connectionId : c.bosta?.connectionId;
          if (!connectionId) return;
          await this.db.tenant(tenantId, (trx) => trx.updateTable("connections")
            .set({ learned: JSON.stringify(state), updated_at: new Date() }).where("id", "=", connectionId).execute());
        },
      },
    };
    const engine = new MizanEngine(store, this.runtime(tenantId, c), options);
    engine.on((event, data) => this.sink(tenantId, event, data));
    await engine.init();
    const entry: TenantEngine = { tenantId, engine, store, connections: c, builtAt: Date.now() };
    this.cache.set(tenantId, entry);
    return entry;
  }
}

export const defaultRuntimeFactory: RuntimeFactory = (tenantId) => defaultRuntime({ logger: engineLogger(tenantId) });

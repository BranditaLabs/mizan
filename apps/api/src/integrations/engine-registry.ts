import { randomBytes } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { CANCEL_RESULTS } from "../modules/orders/ports.js";
import { defaultRuntime, MizanEngine, SqlStore, type CancelOutcome, type EngineOptions, type OfferOutcome, type Runtime } from "@mizan/engine";
import { tenantQueryClient } from "@mizan/db";
import { APP_CONFIG, type AppConfig } from "../platform/config.js";
import { Database } from "../platform/db/database.js";
import { ConnectionResolver, type ResolvedConnections } from "./connection-resolver.js";
import { ProductProjector } from "../modules/catalog/product-projector.js";
import { CourierAccess } from "./courier-access.js";
import { OrderProjector } from "../modules/orders/order-projector.js";
import { ReconciliationService } from "../modules/orders/reconciliation.service.js";

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
interface CancelResultSink { recordStoreCancel(tenantId: string, connectionId: string, externalId: string, result: CancelOutcome): Promise<void> }

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
 * One MizanEngine per store (a tenant's Shopify connection, E2-7), built from that store's
 * connection, the tenant's Bosta account and decrypted credentials. Each engine owns its
 * connectors, so circuit breakers and rate buckets are per store: one store being throttled or
 * down never slows another. Its SqlStore runs every query under the tenant's RLS context and
 * keeps the store's rows (records, cursors, jobs, dedupe keys) apart from its other stores'.
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
    @Inject(ReconciliationService) private readonly reconciliation: ReconciliationService,
  ) {}

  /** M2 depends on the engine and the engine reports back to M2: resolved when first needed. */
  private get cancelResults(): CancelResultSink | undefined {
    try { return this.moduleRef.get<CancelResultSink>(CANCEL_RESULTS, { strict: false }); } catch { return undefined; }
  }

  private get offerResults(): OfferResultSink | undefined {
    try { return this.moduleRef.get<OfferResultSink>(OFFER_RESULTS, { strict: false }); } catch { return undefined; }
  }

  /**
   * The engine of one of the tenant's stores (E2-7: one engine per Shopify connection).
   * Without `storeId`, the tenant's first store: right for one-store tenants and for calls
   * that are not about a store (Bosta access checks, admin views of the first store).
   */
  async get(tenantId: string, storeId?: string): Promise<TenantEngine> {
    const store = storeId ?? (await this.resolver.stores(tenantId))[0] ?? "";
    const key = `${tenantId}|${store}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.builtAt < ENGINE_TTL_MS) return hit;
    const pending = this.building.get(key);
    if (pending) return pending;
    const build = this.build(tenantId, store || undefined).then((e) => { this.cache.set(key, e); return e; }).finally(() => this.building.delete(key));
    this.building.set(key, build);
    return build;
  }

  /** Every store engine of a tenant (Bosta webhooks find the store that owns a shipment). */
  async forTenant(tenantId: string): Promise<TenantEngine[]> {
    return Promise.all((await this.resolver.stores(tenantId)).map((id) => this.get(tenantId, id)));
  }

  /** Drop a tenant's engines (connection added, removed or rotated). */
  invalidate(tenantId: string): void {
    for (const key of [...this.cache.keys()]) if (key.startsWith(`${tenantId}|`)) this.cache.delete(key);
  }

  /** Engines built on this instance (metrics). */
  all(): TenantEngine[] {
    return [...this.cache.values()];
  }

  cached(tenantId: string): TenantEngine | undefined {
    return [...this.cache.entries()].find(([k]) => k.startsWith(`${tenantId}|`))?.[1];
  }

  private async build(tenantId: string, storeId?: string): Promise<TenantEngine> {
    const c = await this.resolver.resolve(tenantId, storeId);
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
        // A store day was reconciled (E5-8): Mizan counts its own orders and records the result.
        onReconciled: async (result) => {
          await this.reconciliation.record(tenantId, c.shopify.connectionId, result);
        },
        // A bulk cancel reached the store's order, or could not (E5-4): a failure shows on the order.
        onCancelResult: async (orderId, result) => {
          await this.cancelResults?.recordStoreCancel(tenantId, c.shopify.connectionId, orderId, result);
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
    return { tenantId, engine, store, connections: c, builtAt: Date.now() };
  }
}

export const defaultRuntimeFactory: RuntimeFactory = (tenantId) => defaultRuntime({ logger: engineLogger(tenantId) });

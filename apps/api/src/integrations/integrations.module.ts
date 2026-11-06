import { Global, Logger, Module, type DynamicModule } from "@nestjs/common";
import { ConnectionLifecycle } from "./connection-lifecycle.js";
import { ConnectionResolver } from "./connection-resolver.js";
import { CourierAccess } from "./courier-access.js";
import { SyncResults } from "./sync-results.js";
import { ENGINE_EVENT_SINK, ENGINE_RUNTIME, EngineRegistry, defaultRuntimeFactory, type EngineEventSink, type RuntimeFactory } from "./engine-registry.js";
import { EngineJobRunner } from "./engine-runner.js";
import { ShopifyTokens } from "./shopify-tokens.js";
import { StoreProfile } from "./store-profile.js";
import { ShopifyConnectedConsumer } from "./shopify-connected.consumer.js";
import { ConnectionNoticesConsumer } from "./connection-notices.consumer.js";
import { StoreWritebackConsumer } from "./store-writeback.consumer.js";
import { SyncGuardian } from "./sync-guardian.js";
import { WebhookRouter } from "./webhook-router.js";
import { WebhooksController } from "./webhooks.controller.js";

const logSink: EngineEventSink = (tenantId, event, data) => new Logger("EngineEvents").debug({ tenantId, ...data }, event);

/** The integration engine inside the platform (docs/03 §6). */
@Global()
@Module({})
export class IntegrationsModule {
  static forRoot(runtime: RuntimeFactory = defaultRuntimeFactory, sink: EngineEventSink = logSink): DynamicModule {
    return {
      module: IntegrationsModule,
      controllers: [WebhooksController],
      providers: [
        WebhookRouter,
        ConnectionResolver,
        EngineRegistry,
        EngineJobRunner,
        ShopifyConnectedConsumer,
        ConnectionNoticesConsumer,
        StoreWritebackConsumer,
        SyncGuardian,
        ConnectionLifecycle,
        CourierAccess,
        SyncResults,
        ShopifyTokens,
        StoreProfile,
        { provide: ENGINE_RUNTIME, useValue: runtime },
        { provide: ENGINE_EVENT_SINK, useValue: sink },
      ],
      exports: [SyncGuardian, ConnectionLifecycle, ShopifyTokens, ConnectionResolver, EngineRegistry, EngineJobRunner, WebhookRouter, ENGINE_RUNTIME],
    };
  }
}

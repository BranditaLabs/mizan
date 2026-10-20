import { Global, Logger, Module, type DynamicModule } from "@nestjs/common";
import { ConnectionResolver } from "./connection-resolver.js";
import { ENGINE_EVENT_SINK, ENGINE_RUNTIME, EngineRegistry, defaultRuntimeFactory, type EngineEventSink, type RuntimeFactory } from "./engine-registry.js";
import { EngineJobRunner } from "./engine-runner.js";

const logSink: EngineEventSink = (tenantId, event, data) => new Logger("EngineEvents").debug({ tenantId, ...data }, event);

/** The integration engine inside the platform (docs/03 §6). */
@Global()
@Module({})
export class IntegrationsModule {
  static forRoot(runtime: RuntimeFactory = defaultRuntimeFactory, sink: EngineEventSink = logSink): DynamicModule {
    return {
      module: IntegrationsModule,
      providers: [
        ConnectionResolver,
        EngineRegistry,
        EngineJobRunner,
        { provide: ENGINE_RUNTIME, useValue: runtime },
        { provide: ENGINE_EVENT_SINK, useValue: sink },
      ],
      exports: [ConnectionResolver, EngineRegistry, EngineJobRunner],
    };
  }
}

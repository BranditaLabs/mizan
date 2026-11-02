import { Inject, Injectable, type OnApplicationBootstrap } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import type { FastifyInstance } from "fastify";

/**
 * Fastify builds each route's hooks when it becomes ready. `listen()` does that; `app.init()`
 * alone (tests, the load harness) does not, so the app is made ready once the routes and the
 * not-found handler are registered: application bootstrap runs right after them.
 */
@Injectable()
export class FastifyReady implements OnApplicationBootstrap {
  constructor(@Inject(HttpAdapterHost) private readonly host: HttpAdapterHost) {}

  async onApplicationBootstrap(): Promise<void> {
    const instance = this.host.httpAdapter?.getInstance?.() as FastifyInstance | undefined;
    if (instance && typeof instance.ready === "function") await instance.ready();
  }
}

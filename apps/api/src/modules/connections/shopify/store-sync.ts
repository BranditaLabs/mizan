import { Body, Controller, Get, Inject, Injectable, Param, ParseUUIDPipe, Put } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { AuditService, auditActor } from "../../../platform/audit/audit.service.js";
import { Auth, Roles } from "../../../platform/auth/decorators.js";
import type { AuthContext } from "../../../platform/auth/auth.types.js";
import { Database } from "../../../platform/db/database.js";
import { ApiJson, ApiJsonBody, ApiProblems } from "../../../platform/http/api-schema.js";
import { ProblemError } from "../../../platform/http/problem.js";
import { ZodPipe } from "../../../platform/http/zod.pipe.js";
import { EngineRegistry } from "../../../integrations/engine-registry.js";
import { PutStoreSyncSchema, StoreSyncSchema, storeSyncOf, type StoreSync } from "../../../integrations/store-sync-options.js";

export { DEFAULT_SYNC, engineSyncOptions, storeSyncOf } from "../../../integrations/store-sync-options.js";

@Injectable()
export class StoreSyncService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EngineRegistry) private readonly engines: EngineRegistry,
  ) {}

  async get(auth: AuthContext, connectionId: string): Promise<StoreSync> {
    return this.db.tenant(auth.tenant!.id, async (trx) => storeSyncOf((await this.store(trx, connectionId)).config as Record<string, unknown>));
  }

  async put(auth: AuthContext, connectionId: string, change: Partial<StoreSync>): Promise<StoreSync> {
    const next = await this.db.tenant(auth.tenant!.id, async (trx) => {
      const c = await this.store(trx, connectionId, true);
      const config = (c.config ?? {}) as Record<string, unknown>;
      const before = storeSyncOf(config);
      const after = { ...before, ...change };
      await trx.updateTable("connections").set({ config: JSON.stringify({ ...config, sync: after }), updated_at: new Date() }).where("id", "=", connectionId).execute();
      await this.audit.record(trx, { action: "connection.sync_updated", tenantId: auth.tenant!.id, ...auditActor(auth), entity: { type: "connection", id: connectionId }, before, after });
      return after;
    });
    this.engines.invalidate(auth.tenant!.id); // the store's engine picks the switches up on its next job
    return next;
  }

  private async store(trx: Parameters<Parameters<Database["tenant"]>[1]>[0], id: string, lock = false) {
    let q = trx.selectFrom("connections").select(["id", "config"]).where("id", "=", id).where("provider", "=", "shopify");
    if (lock) q = q.forUpdate();
    const c = await q.executeTakeFirst();
    if (!c) throw new ProblemError(404, "not_found", "no Shopify store with this id");
    return c;
  }
}

@ApiTags("connections")
@Controller("connections")
@Roles("owner", "admin")
export class StoreSyncController {
  constructor(@Inject(StoreSyncService) private readonly sync: StoreSyncService) {}

  @Get(":id/sync")
  @ApiJson(200, "StoreSync", StoreSyncSchema, "What Mizan writes back to this Shopify store as the courier reports")
  @ApiProblems(404)
  get(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.sync.get(auth, id);
  }

  @Put(":id/sync")
  @ApiJsonBody("PutStoreSync", PutStoreSyncSchema)
  @ApiJson(200, "StoreSync", StoreSyncSchema, "Changed; audited (connection.sync_updated)")
  @ApiProblems(404, 422)
  put(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string, @Body(new ZodPipe(PutStoreSyncSchema)) body: z.output<typeof PutStoreSyncSchema>) {
    return this.sync.put(auth, id, body);
  }
}

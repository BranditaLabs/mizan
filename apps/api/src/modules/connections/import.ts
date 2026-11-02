import { randomUUID } from "node:crypto";
import { Controller, HttpCode, Inject, Injectable, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { trxQueryClient } from "@mizan/db";
import { MizanEngine, SqlStore } from "@mizan/engine";
import { AuditService, auditActor } from "../../platform/audit/audit.service.js";
import { Auth, Roles } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { Database } from "../../platform/db/database.js";
import { ApiJson, ApiProblems } from "../../platform/http/api-schema.js";
import { ProblemError } from "../../platform/http/problem.js";
import { ENGINE_RUNTIME, type RuntimeFactory } from "../../integrations/engine-registry.js";
import { BACKFILL_DAYS } from "../../integrations/shopify-connected.consumer.js";
import { WOO_BACKFILL_DAYS } from "./woocommerce/woocommerce-connect.service.js";

export const StartImportSchema = z.object({
  connectionId: z.uuid(), days: z.number().int().describe("How far back orders are read (Shopify: 60 without read_all_orders)"),
});

/**
 * Import a store's history again (A2): after a failed import, or to catch up. A new run replaces the
 * last one's progress (setup shows it); unchanged orders are skipped. Queued as engine jobs (rule 3).
 */
@Injectable()
export class StoreImportService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ENGINE_RUNTIME) private readonly runtime: RuntimeFactory,
  ) {}

  async start(auth: AuthContext, connectionId: string): Promise<z.infer<typeof StartImportSchema>> {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const c = await trx.selectFrom("connections").select(["id", "provider", "status"]).where("id", "=", connectionId).where("kind", "=", "store").executeTakeFirst();
      if (!c || (c.provider !== "shopify" && c.provider !== "woocommerce")) throw new ProblemError(404, "not_found", "no store connection with this id");
      if (c.status === "disconnected") throw new ProblemError(409, "store_not_connected", "this store is disconnected: connect it again first");
      const store = new SqlStore(trxQueryClient(trx), { tenantId, store: c.id, connections: { [c.provider]: c.id } });
      const now = this.runtime(tenantId).clock.now(); // the engine's clock schedules its jobs
      const runKey = randomUUID();
      const days = c.provider === "shopify" ? BACKFILL_DAYS : WOO_BACKFILL_DAYS;
      if (c.provider === "shopify") await store.enqueue(MizanEngine.shopifyBackfillJob(runKey, now - days * 86_400_000, now), now);
      else await store.enqueue(MizanEngine.wooBackfillJob(runKey, now - days * 86_400_000), now);
      await this.audit.record(trx, { action: "connection.import_started", tenantId, ...auditActor(auth), entity: { type: "connection", id: c.id }, after: { provider: c.provider, days } });
      return { connectionId: c.id, days };
    });
  }
}

@ApiTags("connections")
@Controller("connections")
@Roles("owner", "admin")
export class StoreImportController {
  constructor(@Inject(StoreImportService) private readonly imports: StoreImportService) {}

  @Post(":id/import")
  @HttpCode(202)
  @ApiJson(202, "StartImport", StartImportSchema, "Import the store's recent history again (after a failed import); audited (connection.import_started)")
  @ApiProblems(404, 409)
  start(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.imports.start(auth, id);
  }
}

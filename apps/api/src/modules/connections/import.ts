import { randomUUID } from "node:crypto";
import { Controller, Get, HttpCode, Inject, Injectable, Param, ParseUUIDPipe, Post } from "@nestjs/common";
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
import { ENGINE_RUNTIME, EngineRegistry, type RuntimeFactory } from "../../integrations/engine-registry.js";
import { BACKFILL_DAYS } from "../../integrations/shopify-connected.consumer.js";
import { WOO_BACKFILL_DAYS } from "./woocommerce/woocommerce-connect.service.js";

export const StoreImportsSchema = z.object({
  data: z.array(z.object({
    connectionId: z.uuid(), provider: z.enum(["shopify", "woocommerce"]), shop: z.string().describe("The store's address"),
    connection: z.enum(["pending", "active", "needs_attention"]).describe("The connection's own status; needs_attention: the store refused Mizan"),
    import: z.object({
      status: z.enum(["running", "done", "failed"]), phase: z.enum(["orders", "products", "done"]), orders: z.number().int(), products: z.number().int(),
      error: z.string().nullable(), startedAt: z.iso.datetime(), finishedAt: z.iso.datetime().nullable(),
    }).nullable().describe("The latest history import; null before the first"),
  })),
});
export type StoreImports = z.infer<typeof StoreImportsSchema>;

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
    @Inject(EngineRegistry) private readonly engines: EngineRegistry,
  ) {}

  /** Every connected store and its latest import (A3: the app frame's sync indicator, polled while one runs). */
  async list(tenantId: string): Promise<StoreImports> {
    const stores = await this.db.tenant(tenantId, (trx) => trx.selectFrom("connections").select(["id", "provider", "external_account", "status"])
      .where("kind", "=", "store").where("provider", "in", ["shopify", "woocommerce"]).where("status", "!=", "disconnected").orderBy("created_at").execute());
    const data: StoreImports["data"] = [];
    for (const c of stores) {
      let imp: StoreImports["data"][number]["import"] = null;
      try {
        const b = await (await this.engines.get(tenantId, c.id)).engine.backfillStatus();
        if (b) imp = { status: b.status, phase: b.phase, orders: b.orders, products: b.products, error: b.error?.kind ?? null, startedAt: b.startedAt, finishedAt: b.finishedAt ?? null };
      } catch {
        /* the engine can't be built (credentials being replaced): no progress to show */
      }
      data.push({ connectionId: c.id, provider: c.provider as "shopify" | "woocommerce", shop: c.external_account ?? "", connection: c.status as "pending" | "active" | "needs_attention", import: imp });
    }
    return { data };
  }

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

  @Get("imports")
  @Roles("owner", "admin", "ops_manager")
  @ApiJson(200, "StoreImports", StoreImportsSchema, "Each connected store's status and latest history import (running, done or failed with why)")
  list(@Auth() auth: AuthContext) {
    return this.imports.list(auth.tenant!.id);
  }

  @Post(":id/import")
  @HttpCode(202)
  @ApiJson(202, "StartImport", StartImportSchema, "Import the store's recent history again (after a failed import); audited (connection.import_started)")
  @ApiProblems(404, 409)
  start(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.imports.start(auth, id);
  }
}

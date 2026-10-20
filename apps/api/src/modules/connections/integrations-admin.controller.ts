import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { AuditService, auditActor } from "../../platform/audit/audit.service.js";
import { Auth, Roles } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { Database } from "../../platform/db/database.js";
import { ProblemError } from "../../platform/http/problem.js";
import { ZodPipe } from "../../platform/http/zod.pipe.js";
import { scrubText } from "../../platform/logging/redact.js";
import { NotConnectedError } from "../../integrations/connection-resolver.js";
import { EngineRegistry } from "../../integrations/engine-registry.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ResolveCitySchema = z.strictObject({
  /** The address text the engine could not match, as shown in the dead letter. */
  text: z.string().trim().min(2).max(120),
  /** Bosta city id to map it to. */
  cityId: z.string().trim().min(1).max(64),
  /** The stuck job to replay once the city is known. */
  jobId: z.string().regex(UUID).optional(),
});

const ListSchema = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });

/**
 * Integration operations for a store's team (docs/05 "Admin / integration ops"):
 * engine health, jobs that need a person, replay after a fix, and teaching the
 * courier a city name. Ported from the standalone engine's /ops/* routes.
 */
@ApiTags("integrations")
@Controller("admin/integrations")
@Roles("owner", "admin", "ops_manager")
export class IntegrationsAdminController {
  constructor(
    @Inject(EngineRegistry) private readonly registry: EngineRegistry,
    @Inject(Database) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get("health")
  async health(@Auth() auth: AuthContext) {
    const connections = await this.db.tenant(auth.tenant!.id, (trx) => trx.selectFrom("connections")
      .select(["id", "kind", "provider", "external_account", "status", "status_reason", "updated_at"]).orderBy("created_at").orderBy("provider").execute());
    const list = connections.map((c) => ({
      id: c.id, kind: c.kind, provider: c.provider, account: c.external_account, status: c.status, reason: c.status_reason, updatedAt: c.updated_at.toISOString(),
    }));
    try {
      const { engine } = await this.registry.get(auth.tenant!.id);
      const h = await engine.health();
      return {
        connected: true,
        connections: list,
        shopify: h.shopify,
        bosta: h.bosta,
        outbox: h.outbox,
        deadLetters: h.deadLetters.map((d) => ({ ...d, error: d.error ? scrubText(d.error) : null })),
        drift: h.drift,
        backfill: await engine.backfillStatus(),
      };
    } catch (err) {
      if (err instanceof NotConnectedError) return { connected: false, reason: err.detail, connections: list };
      throw err;
    }
  }

  @Get("dead-letters")
  async deadLetters(@Auth() auth: AuthContext, @Query(new ZodPipe(ListSchema)) q: z.infer<typeof ListSchema>) {
    const { store } = await this.engineFor(auth);
    const dead = await store.jobs({ status: "dead" });
    return {
      data: dead.slice(-q.limit).reverse().map((j) => ({
        id: j.id, kind: j.kind, provider: j.connection, attempts: j.attempts,
        error: j.lastError ? scrubText(j.lastError) : null,
        payload: j.payload, failedAt: new Date(j.updatedAt).toISOString(),
      })),
    };
  }

  @Post("jobs/:id/replay")
  @HttpCode(200)
  async replay(@Auth() auth: AuthContext, @Param("id") id: string) {
    if (!UUID.test(id)) throw new ProblemError(404, "job_not_found", "no dead-lettered job with this id");
    const { engine } = await this.engineFor(auth);
    if (!(await engine.replay(id))) throw new ProblemError(404, "job_not_found", "no dead-lettered job with this id");
    await this.db.tenant(auth.tenant!.id, (trx) => this.audit.record(trx, {
      action: "integration.job_replayed", tenantId: auth.tenant!.id, ...auditActor(auth), entity: { type: "engine_job", id },
    }));
    return { replayed: true };
  }

  @Post("cities/resolve")
  @HttpCode(200)
  async resolveCity(@Auth() auth: AuthContext, @Body(new ZodPipe(ResolveCitySchema)) body: z.infer<typeof ResolveCitySchema>) {
    const { engine } = await this.engineFor(auth);
    const replayed = await engine.resolveCity(body.text, body.cityId, body.jobId);
    if (body.jobId && !replayed) throw new ProblemError(404, "job_not_found", "the city was saved, but no dead-lettered job has this id");
    await this.db.tenant(auth.tenant!.id, (trx) => this.audit.record(trx, {
      action: "integration.city_resolved", tenantId: auth.tenant!.id, ...auditActor(auth),
      entity: { type: "city_alias", id: body.cityId }, after: { cityId: body.cityId, jobId: body.jobId ?? null },
    }));
    return { saved: true, replayed: Boolean(body.jobId) };
  }

  private async engineFor(auth: AuthContext) {
    return this.registry.get(auth.tenant!.id);
  }
}

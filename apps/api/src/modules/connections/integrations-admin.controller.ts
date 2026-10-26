import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { AuditService, auditActor } from "../../platform/audit/audit.service.js";
import { Auth, Roles } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { Database } from "../../platform/db/database.js";
import { ApiJson, ApiJsonBody, ApiProblems, ApiQueryZod } from "../../platform/http/api-schema.js";
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
const HealthQuerySchema = z.object({ connectionId: z.uuid().optional().describe("Which Shopify store (default: the first)") });

const ConnectionSummarySchema = z.object({
  id: z.uuid(), kind: z.string(), provider: z.string(), account: z.string().nullable(),
  status: z.string(), reason: z.string().nullable(), updatedAt: z.iso.datetime(),
});
/** Engine state for the store; without a working connection only `connections` and `reason` are present. */
const IntegrationsHealthSchema = z.object({
  connected: z.boolean(),
  reason: z.string().optional(),
  connections: z.array(ConnectionSummarySchema),
  shopify: z.unknown().optional().describe("Circuit breaker and rate-limit state"),
  bosta: z.unknown().optional().describe("Circuit breaker and rate-limit state"),
  outbox: z.object({ pending: z.number().int(), dead: z.number().int() }).optional(),
  deadLetters: z.array(z.object({ id: z.string(), kind: z.string(), attempts: z.number().int(), error: z.string().nullable() })).optional(),
  drift: z.array(z.unknown()).optional().describe("Provider fields that changed shape (schema drift)"),
  backfill: z.unknown().optional().describe("Shopify history import progress, or null"),
});
type IntegrationsHealth = z.infer<typeof IntegrationsHealthSchema>;
const DeadLettersSchema = z.object({
  data: z.array(z.object({
    id: z.string(), kind: z.string(), provider: z.string(), attempts: z.number().int(), error: z.string().nullable(), payload: z.unknown(), failedAt: z.iso.datetime(),
  })),
});
const ReplayedSchema = z.object({ replayed: z.literal(true) });
const CityResolvedSchema = z.object({ saved: z.literal(true), replayed: z.boolean() });

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
  @ApiQueryZod(HealthQuerySchema)
  @ApiJson(200, "IntegrationsHealth", IntegrationsHealthSchema, "Connections, and one store's engine queues, dead letters and drift")
  async health(@Auth() auth: AuthContext, @Query(new ZodPipe(HealthQuerySchema)) q: z.infer<typeof HealthQuerySchema>): Promise<IntegrationsHealth> {
    const connections = await this.db.tenant(auth.tenant!.id, (trx) => trx.selectFrom("connections")
      .select(["id", "kind", "provider", "external_account", "status", "status_reason", "updated_at"]).orderBy("created_at").orderBy("provider").execute());
    const list = connections.map((c) => ({
      id: c.id, kind: c.kind, provider: c.provider, account: c.external_account, status: c.status, reason: c.status_reason, updatedAt: c.updated_at.toISOString(),
    }));
    try {
      const { engine } = await this.registry.get(auth.tenant!.id, q.connectionId);
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
  @ApiQueryZod(ListSchema)
  @ApiJson(200, "DeadLetters", DeadLettersSchema, "Jobs that need a person, newest first (every store)")
  async deadLetters(@Auth() auth: AuthContext, @Query(new ZodPipe(ListSchema)) q: z.infer<typeof ListSchema>) {
    const dead = (await Promise.all((await this.registry.forTenant(auth.tenant!.id)).map((e) => e.store.jobs({ status: "dead" }))))
      .flat().sort((a, b) => a.updatedAt - b.updatedAt);
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
  @ApiJson(200, "Replayed", ReplayedSchema, "Queued again")
  @ApiProblems(404)
  async replay(@Auth() auth: AuthContext, @Param("id") id: string) {
    if (!UUID.test(id)) throw new ProblemError(404, "job_not_found", "no dead-lettered job with this id");
    const { engine } = await this.engineFor(auth, id);
    if (!(await engine.replay(id))) throw new ProblemError(404, "job_not_found", "no dead-lettered job with this id");
    await this.db.tenant(auth.tenant!.id, (trx) => this.audit.record(trx, {
      action: "integration.job_replayed", tenantId: auth.tenant!.id, ...auditActor(auth), entity: { type: "engine_job", id },
    }));
    return { replayed: true as const };
  }

  @Post("cities/resolve")
  @HttpCode(200)
  @ApiJsonBody("ResolveCity", ResolveCitySchema)
  @ApiJson(200, "CityResolved", CityResolvedSchema, "Saved, and the job replayed when one was given")
  @ApiProblems(404)
  async resolveCity(@Auth() auth: AuthContext, @Body(new ZodPipe(ResolveCitySchema)) body: z.infer<typeof ResolveCitySchema>) {
    const { engine } = await this.engineFor(auth, body.jobId);
    const replayed = await engine.resolveCity(body.text, body.cityId, body.jobId);
    this.registry.invalidate(auth.tenant!.id); // the alias belongs to the Bosta account: every store's engine learns it
    if (body.jobId && !replayed) throw new ProblemError(404, "job_not_found", "the city was saved, but no dead-lettered job has this id");
    await this.db.tenant(auth.tenant!.id, (trx) => this.audit.record(trx, {
      action: "integration.city_resolved", tenantId: auth.tenant!.id, ...auditActor(auth),
      entity: { type: "city_alias", id: body.cityId }, after: { cityId: body.cityId, jobId: body.jobId ?? null },
    }));
    return { saved: true as const, replayed: Boolean(body.jobId) };
  }

  /** The engine of the store a job belongs to (jobs are per store, E2-7); the first store otherwise. */
  private async engineFor(auth: AuthContext, jobId?: string) {
    const tenantId = auth.tenant!.id;
    const scope = jobId && UUID.test(jobId)
      ? (await this.db.tenant(tenantId, (trx) => trx.selectFrom("mz_outbox").select("scope").where("id", "=", jobId).executeTakeFirst()))?.scope
      : undefined;
    return this.registry.get(tenantId, scope || undefined);
  }
}

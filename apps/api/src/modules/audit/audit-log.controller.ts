import { Controller, Get, Inject, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ApiJson, ApiQueryZod } from "../../platform/http/api-schema.js";
import { z } from "zod";
import { Auth, Roles } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { Database } from "../../platform/db/database.js";
import { ZodPipe } from "../../platform/http/zod.pipe.js";

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().regex(/^\d+$/).optional(),
  /** Exact action ("member.removed") or prefix ("member."). */
  action: z.string().regex(/^[a-z_]+\.[a-z_]*$/).optional(),
});

export const AuditLogEntrySchema = z.object({
  id: z.string().describe("Increasing id; use as cursor"),
  action: z.string().describe('For example "member.removed"'),
  actor: z.object({ type: z.string(), id: z.string().nullable(), displayName: z.string().nullable() }),
  entity: z.object({ type: z.string(), id: z.string() }).nullable(),
  before: z.unknown(),
  after: z.unknown(),
  ip: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type AuditLogEntryView = z.infer<typeof AuditLogEntrySchema>;
const AuditLogPageSchema = z.object({ data: z.array(AuditLogEntrySchema), nextCursor: z.string().nullable() });

/** GET /v1/audit-log — who did what in this store, newest first (owner, admin). */
@ApiTags("platform")
@Controller("audit-log")
export class AuditLogController {
  constructor(@Inject(Database) private readonly db: Database) {}

  @Get()
  @Roles("owner", "admin")
  @ApiQueryZod(QuerySchema)
  @ApiJson(200, "AuditLogPage", AuditLogPageSchema, "Newest first; pass nextCursor as cursor for the next page")
  async list(@Auth() auth: AuthContext, @Query(new ZodPipe(QuerySchema)) q: z.infer<typeof QuerySchema>) {
    const rows = await this.db.tenant(auth.tenant!.id, (trx) => {
      let query = trx.selectFrom("audit_log as a").leftJoin("users as u", "u.id", "a.actor_id")
        .select(["a.id", "a.action", "a.actor_type", "a.actor_id", "u.display_name", "a.entity_type", "a.entity_id", "a.before", "a.after", "a.ip", "a.created_at"])
        .orderBy("a.id", "desc").limit(q.limit + 1);
      if (q.cursor) query = query.where("a.id", "<", BigInt(q.cursor));
      if (q.action) query = q.action.endsWith(".") ? query.where("a.action", "like", `${q.action}%`) : query.where("a.action", "=", q.action);
      return query.execute();
    });
    const page = rows.slice(0, q.limit);
    const data: AuditLogEntryView[] = page.map((r) => ({
      id: String(r.id),
      action: r.action,
      actor: { type: r.actor_type, id: r.actor_id, displayName: r.display_name },
      entity: r.entity_type && r.entity_id ? { type: r.entity_type, id: r.entity_id } : null,
      before: r.before,
      after: r.after,
      ip: r.ip,
      createdAt: r.created_at.toISOString(),
    }));
    return { data, nextCursor: rows.length > q.limit ? String(page.at(-1)!.id) : null };
  }
}

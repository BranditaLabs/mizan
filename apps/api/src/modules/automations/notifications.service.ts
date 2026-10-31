import { Inject, Injectable } from "@nestjs/common";
import { sql } from "kysely";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { Database } from "../../platform/db/database.js";

/**
 * Team notifications (E11-1): what automations (notify.team) and the platform want the team to
 * see, addressed to roles. Each person sees those for their role and marks them read.
 */
@Injectable()
export class NotificationsService {
  constructor(@Inject(Database) private readonly db: Database) {}

  async list(auth: AuthContext, limit: number) {
    const tenantId = auth.tenant!.id;
    const role = auth.tenant!.role;
    return this.db.tenant(tenantId, async (trx) => {
      const mine = trx.selectFrom("notifications as n").where(sql<boolean>`${role} = ANY(n.roles)`);
      const rows = await mine.leftJoin("notification_reads as r", (j) => j.onRef("r.notification_id", "=", "n.id").on("r.user_id", "=", auth.user.id))
        .select(["n.id", "n.created_at", "n.text", "n.source", "n.entity_type", "n.entity_id", "r.read_at"]).orderBy("n.created_at", "desc").limit(limit).execute();
      const unread = await mine.where((eb) => eb.not(eb.exists(eb.selectFrom("notification_reads as r").select("r.user_id")
        .whereRef("r.notification_id", "=", "n.id").where("r.user_id", "=", auth.user.id)))).select(sql<string>`count(*)`.as("n")).executeTakeFirstOrThrow();
      return {
        data: rows.map((r) => ({
          id: r.id, at: r.created_at.toISOString(), text: r.text, source: r.source,
          entity: r.entity_type && r.entity_id ? { type: r.entity_type, id: r.entity_id } : null, read: r.read_at !== null,
        })),
        unread: Number(unread.n),
      };
    });
  }

  async markRead(auth: AuthContext, body: { ids?: string[] | undefined; all?: true | undefined }) {
    const tenantId = auth.tenant!.id;
    const role = auth.tenant!.role;
    return this.db.tenant(tenantId, async (trx) => {
      let q = trx.selectFrom("notifications").select("id").where(sql<boolean>`${role} = ANY(roles)`);
      if (body.ids) q = q.where("id", "in", body.ids);
      const ids = (await q.execute()).map((r) => r.id);
      if (!ids.length) return { marked: 0 };
      const r = await trx.insertInto("notification_reads").values(ids.map((id) => ({ tenant_id: tenantId, notification_id: id, user_id: auth.user.id })))
        .onConflict((oc) => oc.columns(["notification_id", "user_id"]).doNothing()).executeTakeFirst();
      return { marked: Number(r.numInsertedOrUpdatedRows ?? 0) };
    });
  }
}

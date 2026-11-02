import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";
import type { z } from "zod";
import type { DB } from "@mizan/db";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { Database } from "../../platform/db/database.js";
import { ProblemError } from "../../platform/http/problem.js";
import { StaffService } from "../staff/staff.service.js";
import type { FeedbackPageSchema, FeedbackQuerySchema } from "./feedback.dto.js";

type Status = "new" | "seen" | "done";
type Row = {
  id: string; kind: string; message: string; page: string; locale: string; status: string; created_at: Date; updated_at: Date;
  store_id: string; store_name: string; user_id: string | null; display_name: string | null; email: string | null;
};
const view = (r: Row): z.output<typeof FeedbackPageSchema>["data"][number] => ({
  id: r.id, kind: r.kind as "idea", message: r.message, page: r.page, locale: r.locale as "ar", status: r.status as Status,
  store: { id: r.store_id, name: r.store_name },
  person: r.user_id ? { id: r.user_id, name: r.display_name, email: r.email } : null,
  createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(),
});

/**
 * In-app feedback (L1-8). A store member sends an idea, a problem or a question from the screen
 * they are on; the app may only add the line (it never reads feedback back), for the store it is
 * working in. Mizan staff read every store's feedback in the back office and move it from new to
 * seen to done; each change is a line in the staff trail.
 */
@Injectable()
export class FeedbackService {
  constructor(@Inject(Database) private readonly db: Database, @Inject(StaffService) private readonly staff: StaffService) {}

  async send(auth: AuthContext, body: { kind: "idea" | "problem" | "question"; message: string; page: string }): Promise<{ id: string }> {
    const tenantId = auth.tenant!.id;
    const id = randomUUID(); // generated here: the app role cannot read the row back (no RETURNING)
    await this.db.tenant(tenantId, (trx) => trx.insertInto("feedback")
      .values({ id, store_id: tenantId, user_id: auth.user.id, kind: body.kind, message: body.message, page: body.page, locale: auth.user.language })
      .execute());
    return { id };
  }

  async list(q: z.output<typeof FeedbackQuerySchema>) {
    return this.db.staff(async (trx) => {
      let count = trx.selectFrom("feedback as f").select((eb) => eb.fn.countAll<string>().as("n"));
      let rows = this.rows(trx);
      if (q.status) {
        count = count.where("f.status", "=", q.status);
        rows = rows.where("f.status", "=", q.status);
      }
      const total = Number((await count.executeTakeFirstOrThrow()).n);
      const page = await rows.orderBy("f.created_at", "desc").orderBy("f.id").limit(q.limit + 1).offset(q.offset).execute();
      return { data: page.slice(0, q.limit).map(view), total, nextOffset: page.length > q.limit ? q.offset + q.limit : null };
    });
  }

  async update(auth: AuthContext, id: string, status: Status) {
    return this.db.staff(async (trx) => {
      const before = await trx.selectFrom("feedback").select(["status", "store_id"]).where("id", "=", id).forUpdate().executeTakeFirst();
      if (!before) throw new ProblemError(404, "not_found", "no such feedback");
      if (before.status !== status) {
        await trx.updateTable("feedback").set({ status, updated_at: new Date() }).where("id", "=", id).execute();
        await this.staff.record(trx, {
          staffId: auth.staff!.id, userId: auth.user.id, action: "feedback.status_changed", outcome: "ok", targetType: "feedback", targetId: id,
          storeId: before.store_id, data: { before: before.status, after: status }, ...(auth.ip ? { ip: auth.ip } : {}),
        });
      }
      return view(await this.rows(trx).where("f.id", "=", id).executeTakeFirstOrThrow());
    });
  }

  private rows(trx: Transaction<DB>) {
    return trx.selectFrom("feedback as f").innerJoin("tenants as t", "t.id", "f.store_id").leftJoin("users as u", "u.id", "f.user_id")
      .select(["f.id", "f.kind", "f.message", "f.page", "f.locale", "f.status", "f.created_at", "f.updated_at", "f.store_id", "t.name as store_name", "f.user_id", "u.display_name", "u.email"]);
  }
}

import { Inject, Injectable } from "@nestjs/common";
import { sql } from "kysely";
import type { z } from "zod";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { TtlCache } from "../../platform/cache.js";
import { Database } from "../../platform/db/database.js";
import { ProblemError } from "../../platform/http/problem.js";
import type { CreateAnnouncementSchema } from "./flags.dto.js";

type AnnouncementRow = {
  id: string; level: string; title_ar: string; title_en: string; body_ar: string; body_en: string; link: string | null;
  plans: string[] | null; countries: string[] | null; starts_at: Date; ends_at: Date; created_at: Date;
};
const LEVEL_RANK: Record<string, number> = { critical: 0, warning: 1, info: 2 };

/**
 * Feature flags and announcements (A-6). A flag is off unless staff turn it on for everyone or for
 * a store, and a store's own setting wins. Modules ask `isEnabled(tenantId, key)` (cached 30 s per
 * store); the dashboard reads every flag once through GET /v1/flags. Announcements reach every store
 * or those on some plans or in some countries, between their start and end.
 */
@Injectable()
export class FlagsService {
  private readonly cache = new TtlCache<string, Record<string, boolean>>(30_000);

  constructor(@Inject(Database) private readonly db: Database) {}

  async isEnabled(tenantId: string, key: string): Promise<boolean> {
    return (await this.forStore(tenantId))[key] ?? false;
  }

  /** Every flag as it applies to this store. */
  async forStore(tenantId: string): Promise<Record<string, boolean>> {
    const hit = this.cache.get(tenantId);
    if (hit) return hit;
    const flags = await this.db.tenant(tenantId, async (trx) => {
      const rows = await trx.selectFrom("feature_flags as f").leftJoin("feature_flag_stores as s", (j) => j.onRef("s.flag_key", "=", "f.key").on("s.tenant_id", "=", tenantId))
        .select(["f.key", "f.enabled", "s.enabled as store_enabled"]).execute();
      return Object.fromEntries(rows.map((r) => [r.key, r.store_enabled ?? r.enabled]));
    });
    this.cache.set(tenantId, flags);
    return flags;
  }

  async list() {
    return this.db.staff(async (trx) => {
      const [flags, stores] = await Promise.all([
        trx.selectFrom("feature_flags").selectAll().orderBy("key").execute(),
        trx.selectFrom("feature_flag_stores as s").innerJoin("tenants as t", "t.id", "s.tenant_id").select(["s.flag_key", "s.tenant_id", "t.name", "s.enabled"]).orderBy("t.name").execute(),
      ]);
      return {
        data: flags.map((f) => ({
          key: f.key, description: f.description, enabled: f.enabled, updatedAt: f.updated_at.toISOString(),
          stores: stores.filter((s) => s.flag_key === f.key).map((s) => ({ storeId: s.tenant_id, storeName: s.name, enabled: s.enabled })),
        })),
      };
    });
  }

  /** Create or change a flag for everyone. */
  async put(auth: AuthContext, key: string, body: { enabled: boolean; description?: string | undefined }) {
    await this.db.staff((trx) => trx.insertInto("feature_flags")
      .values({ key, enabled: body.enabled, description: body.description ?? "", updated_by: auth.staff!.id })
      .onConflict((oc) => oc.column("key").doUpdateSet({ enabled: body.enabled, ...(body.description !== undefined ? { description: body.description } : {}), updated_by: auth.staff!.id, updated_at: new Date() }))
      .execute());
    this.cache.deleteWhere(() => true);
    return this.one(key);
  }

  /** A store's own setting for a flag (null clears it: the store follows everyone's setting again). */
  async putStore(auth: AuthContext, key: string, storeId: string, enabled: boolean | null) {
    await this.db.staff(async (trx) => {
      if (!(await trx.selectFrom("feature_flags").select("key").where("key", "=", key).executeTakeFirst())) throw new ProblemError(404, "flag_not_found", "no flag with this key");
      if (!(await trx.selectFrom("tenants").select("id").where("id", "=", storeId).executeTakeFirst())) throw new ProblemError(404, "not_found", "no such store");
      if (enabled === null) await trx.deleteFrom("feature_flag_stores").where("flag_key", "=", key).where("tenant_id", "=", storeId).execute();
      else await trx.insertInto("feature_flag_stores").values({ flag_key: key, tenant_id: storeId, enabled, updated_by: auth.staff!.id })
        .onConflict((oc) => oc.columns(["flag_key", "tenant_id"]).doUpdateSet({ enabled, updated_by: auth.staff!.id, updated_at: new Date() })).execute();
    });
    this.cache.delete(storeId);
    return this.one(key);
  }

  async remove(key: string) {
    const r = await this.db.staff((trx) => trx.deleteFrom("feature_flags").where("key", "=", key).executeTakeFirst());
    if (!Number(r.numDeletedRows)) throw new ProblemError(404, "flag_not_found", "no flag with this key");
    this.cache.deleteWhere(() => true);
  }

  private async one(key: string) {
    const f = (await this.list()).data.find((x) => x.key === key);
    if (!f) throw new ProblemError(404, "flag_not_found", "no flag with this key");
    return f;
  }

  async announcements(live: boolean) {
    return this.db.staff(async (trx) => {
      let q = trx.selectFrom("announcements").selectAll().orderBy("created_at", "desc").limit(100);
      if (live) q = q.where("ends_at", ">", new Date());
      return { data: (await q.execute()).map(announcementView) };
    });
  }

  async announce(auth: AuthContext, b: z.output<typeof CreateAnnouncementSchema>) {
    const row = await this.db.staff((trx) => trx.insertInto("announcements").values({
      level: b.level, title_ar: b.titleAr, title_en: b.titleEn, body_ar: b.bodyAr, body_en: b.bodyEn, link: b.link ?? null,
      plans: b.plans ?? null, countries: b.countries ?? null, ends_at: new Date(b.endsAt), created_by: auth.staff!.id,
      ...(b.startsAt ? { starts_at: new Date(b.startsAt) } : {}),
    }).returningAll().executeTakeFirstOrThrow());
    return announcementView(row);
  }

  /** Ends an announcement now (kept for the record). */
  async endAnnouncement(id: string) {
    const row = await this.db.staff(async (trx) => {
      const a = await trx.selectFrom("announcements").select(["id", "starts_at", "ends_at"]).where("id", "=", id).executeTakeFirst();
      if (!a) throw new ProblemError(404, "not_found", "no such announcement");
      const now = new Date();
      if (a.ends_at <= now) return trx.selectFrom("announcements").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
      // Not started yet: it never shows; the window still has to be valid.
      const end = a.starts_at >= now ? new Date(a.starts_at.getTime() + 1) : now;
      return trx.updateTable("announcements").set({ ends_at: end }).where("id", "=", id).returningAll().executeTakeFirstOrThrow();
    });
    return announcementView(row);
  }

  /** What one store sees now, most serious first (both languages: the dashboard shows the one it is in). */
  async forReader(auth: AuthContext) {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const t = await trx.selectFrom("tenants").select(["plan", "country"]).where("id", "=", tenantId).executeTakeFirstOrThrow();
      const now = new Date();
      const rows = await trx.selectFrom("announcements").selectAll().where("starts_at", "<=", now).where("ends_at", ">", now)
        .where((eb) => eb.or([eb("plans", "is", null), eb(sql<string>`${t.plan}`, "=", sql<string>`ANY(plans)`)]))
        .where((eb) => eb.or([eb("countries", "is", null), eb(sql<string>`${t.country}`, "=", sql<string>`ANY(countries)`)]))
        .orderBy("starts_at", "desc").limit(10).execute();
      rows.sort((a, b) => (LEVEL_RANK[a.level] ?? 3) - (LEVEL_RANK[b.level] ?? 3));
      return {
        data: rows.map((r) => ({
          id: r.id, level: r.level as "info", titleAr: r.title_ar, titleEn: r.title_en, bodyAr: r.body_ar, bodyEn: r.body_en,
          link: r.link, endsAt: r.ends_at.toISOString(),
        })),
      };
    });
  }
}

const announcementView = (r: AnnouncementRow) => ({
  id: r.id, level: r.level as "info", titleAr: r.title_ar, titleEn: r.title_en, bodyAr: r.body_ar, bodyEn: r.body_en, link: r.link,
  plans: r.plans, countries: r.countries, startsAt: r.starts_at.toISOString(), endsAt: r.ends_at.toISOString(), createdAt: r.created_at.toISOString(),
});

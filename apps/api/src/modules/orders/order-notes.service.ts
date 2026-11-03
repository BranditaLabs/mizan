import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import type { DB } from "@mizan/db";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { AuditService, auditActor } from "../../platform/audit/audit.service.js";
import { Database } from "../../platform/db/database.js";
import { EventsService } from "../../platform/events/events.service.js";
import { ProblemError } from "../../platform/http/problem.js";
import { PiiCipher } from "../../platform/pii/pii-cipher.js";
import { OrderActions } from "./order-actions.js";
import { roleScope } from "./orders.service.js";
import { SavedViewFiltersSchema, type OrderFiltersSchema, type OrderNoteSchema, type SavedViewSchema } from "./orders.dto.js";
import type { z } from "zod";

type Note = z.infer<typeof OrderNoteSchema>;
type View = z.infer<typeof SavedViewSchema>;
const notFound = () => new ProblemError(404, "not_found", "no such order in this store");
/** Who may delete anyone's note and manage the team's shared views. */
const LEADS = new Set(["owner", "admin", "ops_manager"]);
const NOTES_PER_ORDER = 200;
const VIEWS_PER_PERSON = 30;

/**
 * O2: what the team adds to an order — its notes and tags — and the list's filters and saved
 * views. Notes are the team's only (never sent to the store) and encrypted: a note can name the
 * customer or their address. Tags reach the Shopify order through the outbox (OrderActions).
 */
@Injectable()
export class OrderNotesService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(PiiCipher) private readonly cipher: PiiCipher,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(OrderActions) private readonly actions: OrderActions,
  ) {}

  // ───────────── notes ─────────────

  async notes(auth: AuthContext, orderId: string): Promise<{ data: Note[] }> {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      await this.order(trx, auth, orderId);
      const rows = await trx.selectFrom("order_notes as n").leftJoin("users as u", "u.id", "n.author_id")
        .select(["n.id", "n.body", "n.author_id", "u.display_name", "n.created_at"]).where("n.order_id", "=", orderId)
        .orderBy("n.created_at", "desc").orderBy("n.id", "desc").execute();
      const pii = rows.length ? await this.cipher.forTenant(trx, tenantId) : null;
      return { data: rows.map((r) => this.noteView(r, pii!.decrypt(r.body, "order_notes.body") ?? "", auth)) };
    });
  }

  async addNote(auth: AuthContext, orderId: string, body: string): Promise<Note> {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const o = await this.order(trx, auth, orderId, true);
      const { n } = await trx.selectFrom("order_notes").select(sql<string>`count(*)`.as("n")).where("order_id", "=", o.id).executeTakeFirstOrThrow();
      if (Number(n) >= NOTES_PER_ORDER) throw new ProblemError(409, "too_many_notes", `an order keeps ${NOTES_PER_ORDER} notes at most`);
      const pii = await this.cipher.forTenant(trx, tenantId);
      const row = await trx.insertInto("order_notes").values({ tenant_id: tenantId, order_id: o.id, author_id: auth.user.id, body: pii.encrypt(body, "order_notes.body") })
        .returning(["id", "created_at"]).executeTakeFirstOrThrow();
      // The timeline and the event say a note was added, never what it says.
      await trx.insertInto("order_events").values({ tenant_id: tenantId, order_id: o.id, type: "note_added", actor_type: "user", actor_id: auth.user.id, data: JSON.stringify({}) }).execute();
      await this.events.emit(trx, { type: "order.note_added", tenantId, entity: { type: "order", id: o.id }, actor: { type: "user", id: auth.user.id }, data: { number: o.number, noteId: row.id } });
      const me = await trx.selectFrom("users").select("display_name").where("id", "=", auth.user.id).executeTakeFirst();
      return this.noteView({ id: row.id, author_id: auth.user.id, display_name: me?.display_name ?? null, created_at: row.created_at }, body, auth);
    });
  }

  /** The author takes their note back; the owner, an admin or the ops manager can remove any. */
  async removeNote(auth: AuthContext, orderId: string, noteId: string): Promise<void> {
    const tenantId = auth.tenant!.id;
    await this.db.tenant(tenantId, async (trx) => {
      const o = await this.order(trx, auth, orderId, true);
      const note = await trx.selectFrom("order_notes").select(["id", "author_id"]).where("id", "=", noteId).where("order_id", "=", o.id).executeTakeFirst();
      if (!note) throw new ProblemError(404, "not_found", "no such note on this order");
      if (note.author_id !== auth.user.id && !LEADS.has(auth.tenant!.role)) throw new ProblemError(403, "forbidden", "only the note's author, the owner, an admin or the ops manager can remove it");
      await trx.deleteFrom("order_notes").where("id", "=", note.id).execute();
      await this.audit.record(trx, { action: "order.note_removed", tenantId, ...auditActor(auth), entity: { type: "order", id: o.id }, before: { noteId: note.id, author: note.author_id } });
    });
  }

  // ───────────── tags ─────────────

  async setTags(auth: AuthContext, orderId: string, change: { add: string[]; remove: string[] }): Promise<{ tags: string[] }> {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const o = await this.order(trx, auth, orderId, true);
      const actor = { type: "user" as const, id: auth.user.id };
      // A fresh key per change: adding a tag again after removing it reaches the store again.
      const ref = { op: randomUUID() };
      if (change.remove.length) await this.actions.untag(trx, tenantId, o.id, change.remove, actor, ref);
      if (change.add.length) await this.actions.tag(trx, tenantId, o.id, change.add, actor, ref);
      const { tags } = await trx.selectFrom("orders").select("tags").where("id", "=", o.id).executeTakeFirstOrThrow();
      return { tags };
    });
  }

  // ───────────── filters and saved views ─────────────

  /** The values the list's filters offer: the store's tags, cities and couriers, most orders first. */
  async filters(auth: AuthContext): Promise<z.infer<typeof OrderFiltersSchema>> {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const tags = await trx.selectFrom((db) => db.selectFrom("orders as o").where((eb) => roleScope(eb, auth)).select(sql<string>`unnest(o.tags)`.as("tag")).as("t"))
        .select(["t.tag", sql<string>`count(*)`.as("n")]).groupBy("t.tag").orderBy(sql`count(*)`, "desc").orderBy("t.tag").limit(50).execute();
      // "Giza", "giza " and "GIZA" are one city; the filter matches the same way.
      const cities = await trx.selectFrom("orders as o").where((eb) => roleScope(eb, auth)).where(sql`btrim(coalesce(o.ship_city, ''))`, "!=", "")
        .select([sql<string>`min(btrim(o.ship_city))`.as("city"), sql<string>`count(*)`.as("n")])
        .groupBy(sql`lower(btrim(o.ship_city))`).orderBy(sql`count(*)`, "desc").orderBy(sql`min(btrim(o.ship_city))`).limit(50).execute();
      const couriers = await trx.selectFrom("shipments as s").innerJoin("connections as k", "k.id", "s.connection_id").innerJoin("orders as o", "o.id", "s.order_id")
        .where((eb) => roleScope(eb as never, auth)).where("s.is_return_leg", "=", false)
        .select(["k.id", "k.provider", "k.display_name", sql<string>`count(DISTINCT s.order_id)`.as("n")]).groupBy(["k.id", "k.provider", "k.display_name"]).orderBy(sql`count(DISTINCT s.order_id)`, "desc").execute();
      return {
        tags: tags.map((t) => ({ value: t.tag, count: Number(t.n) })),
        cities: cities.map((c) => ({ value: c.city, count: Number(c.n) })),
        couriers: couriers.map((c) => ({ id: c.id, provider: c.provider, name: c.display_name, count: Number(c.n) })),
      };
    });
  }

  /** The person's own views and the team's shared ones. */
  async views(auth: AuthContext): Promise<{ data: View[] }> {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const rows = await trx.selectFrom("saved_views").selectAll().where("screen", "=", "orders")
        .where((eb) => eb.or([eb("user_id", "=", auth.user.id), eb("shared", "=", true)])).orderBy("shared").orderBy("name").execute();
      return { data: rows.map((r) => this.viewView(r, auth)) };
    });
  }

  async saveView(auth: AuthContext, input: { name: string; filters: z.infer<typeof SavedViewFiltersSchema>; shared: boolean }): Promise<View> {
    const tenantId = auth.tenant!.id;
    if (input.shared && !LEADS.has(auth.tenant!.role)) throw new ProblemError(403, "forbidden", "only the owner, an admin or the ops manager can share a view with the team");
    return this.db.tenant(tenantId, async (trx) => {
      const { n } = await trx.selectFrom("saved_views").select(sql<string>`count(*)`.as("n")).where("user_id", "=", auth.user.id).where("screen", "=", "orders").executeTakeFirstOrThrow();
      if (Number(n) >= VIEWS_PER_PERSON) throw new ProblemError(409, "too_many_views", `${VIEWS_PER_PERSON} saved views per person at most`);
      const row = await trx.insertInto("saved_views").values({
        tenant_id: tenantId, user_id: auth.user.id, screen: "orders", name: input.name, filters: JSON.stringify(input.filters), shared: input.shared,
      }).onConflict((oc) => oc.columns(["tenant_id", "user_id", "screen", "name"]).doNothing()).returningAll().executeTakeFirst();
      if (!row) throw new ProblemError(409, "name_taken", "you already have a view with this name");
      return this.viewView(row, auth);
    });
  }

  async removeView(auth: AuthContext, id: string): Promise<void> {
    const tenantId = auth.tenant!.id;
    await this.db.tenant(tenantId, async (trx) => {
      const v = await trx.selectFrom("saved_views").select(["id", "user_id", "shared"]).where("id", "=", id).where("screen", "=", "orders").executeTakeFirst();
      if (!v || (v.user_id !== auth.user.id && !v.shared)) throw new ProblemError(404, "not_found", "no such view");
      if (v.user_id !== auth.user.id && !LEADS.has(auth.tenant!.role)) throw new ProblemError(403, "forbidden", "only its author, the owner, an admin or the ops manager can remove a shared view");
      await trx.deleteFrom("saved_views").where("id", "=", v.id).execute();
    });
  }

  // ───────────── helpers ─────────────

  /** The order, within the caller's scope (else not found); locked when it is about to change. */
  private async order(trx: Transaction<DB>, auth: AuthContext, orderId: string, lock = false) {
    let q = trx.selectFrom("orders as o").select(["o.id", "o.number"]).where("o.id", "=", orderId).where((eb) => roleScope(eb, auth));
    if (lock) q = q.forUpdate();
    const o = await q.executeTakeFirst();
    if (!o) throw notFound();
    return o;
  }

  private noteView(r: { id: string; author_id: string | null; display_name: string | null; created_at: Date }, body: string, auth: AuthContext): Note {
    return { id: r.id, body, author: r.author_id ? { id: r.author_id, name: r.display_name } : null, mine: r.author_id === auth.user.id, createdAt: r.created_at.toISOString() };
  }

  private viewView(r: { id: string; user_id: string; name: string; filters: unknown; shared: boolean; created_at: Date }, auth: AuthContext): View {
    // A filter a later version no longer knows is dropped, not an error.
    const raw = typeof r.filters === "string" ? JSON.parse(r.filters) : r.filters;
    const parsed = SavedViewFiltersSchema.safeParse(raw);
    const filters = parsed.success ? parsed.data : Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([k, v]) => SavedViewFiltersSchema.shape[k as keyof typeof SavedViewFiltersSchema.shape]?.safeParse(v).success));
    return { id: r.id, name: r.name, filters: filters as View["filters"], shared: r.shared, mine: r.user_id === auth.user.id, createdAt: r.created_at.toISOString() };
  }
}

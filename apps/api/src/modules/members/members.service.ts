import { Inject, Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";
import { setActingUser, type DB } from "@mizan/db";
import { normalizePhone, type MemberRole, type PhoneCountry } from "@mizan/shared";
import { APP_CONFIG, type AppConfig } from "../../platform/config.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { Database } from "../../platform/db/database.js";
import { EventsService } from "../../platform/events/events.service.js";
import { auditActor, AuditService } from "../../platform/audit/audit.service.js";
import { ProblemError } from "../../platform/http/problem.js";
import type { InvitationView, InviteBody, MemberView, MyInvitationView, UpdateMemberBody } from "./members.dto.js";

export const INVITATION_TTL_DAYS = 7;

/** What the identity provider vouches for: verified email, OTP phone. Used to match invitations. */
export function verifiedContact(auth: Pick<AuthContext, "identity">): { email?: string; phone?: string } {
  return {
    ...(auth.identity.email && auth.identity.emailVerified ? { email: auth.identity.email.toLowerCase() } : {}),
    ...(auth.identity.phone ? { phone: auth.identity.phone } : {}),
  };
}

const notFound = () => new ProblemError(404, "invitation_not_found", "no pending invitation for your email or phone");

@Injectable()
export class MembersService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private acceptUrl(id: string) {
    return new URL(`/invitations/${id}`, this.config.WEB_URL).toString();
  }

  async list(tenantId: string): Promise<{ members: MemberView[]; invitations: InvitationView[] }> {
    return this.db.tenant(tenantId, async (trx) => {
      const members = await trx.selectFrom("memberships as m").innerJoin("users as u", "u.id", "m.user_id")
        .select(["m.user_id", "m.role", "m.status", "m.created_at", "u.display_name", "u.email", "u.phone_e164"])
        .orderBy("m.created_at").execute();
      const invitations = await trx.selectFrom("invitations").selectAll()
        .where("status", "=", "pending").orderBy("created_at").execute();
      return {
        members: members.map((m) => ({
          userId: m.user_id, displayName: m.display_name, email: m.email, phone: m.phone_e164,
          role: m.role, status: m.status, joinedAt: m.created_at.toISOString(),
        })),
        invitations: invitations.map((i) => this.toInvitation(i)),
      };
    });
  }

  async invite(auth: AuthContext, body: InviteBody): Promise<InvitationView> {
    const tenant = auth.tenant!;
    if (body.role === "owner" && tenant.role !== "owner") throw new ProblemError(403, "insufficient_role", "only an owner can invite an owner");

    return this.db.tenant(tenant.id, async (trx) => {
      const t = await trx.selectFrom("tenants").select("settings").where("id", "=", tenant.id).executeTakeFirstOrThrow();
      const phoneCountry = ((t.settings as { phoneCountry?: PhoneCountry } | null)?.phoneCountry) ?? "EG";
      let email: string | null = null;
      let phone: string | null = null;
      if (body.email) email = body.email.toLowerCase();
      else {
        phone = normalizePhone(body.phone, phoneCountry)?.e164 ?? null;
        if (!phone) throw new ProblemError(422, "validation_failed", "not a valid mobile number", [{ path: "phone", code: "invalid_phone" }]);
      }

      const existing = await trx.selectFrom("memberships as m").innerJoin("users as u", "u.id", "m.user_id").select("m.status")
        .where((eb) => (email ? eb("u.email", "=", email) : eb("u.phone_e164", "=", phone!)))
        .executeTakeFirst();
      if (existing?.status === "active") throw new ProblemError(409, "already_member", "this person is already a member");

      const expires = new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000);
      // Re-inviting the same person refreshes the pending invitation (new role, new expiry).
      const pending = await trx.selectFrom("invitations").select("id").where("status", "=", "pending")
        .where((eb) => (email ? eb("email", "=", email) : eb("phone_e164", "=", phone!))).executeTakeFirst();
      const row = pending
        ? await trx.updateTable("invitations").set({ role: body.role, expires_at: expires, invited_by: auth.user.id })
          .where("id", "=", pending.id).returningAll().executeTakeFirstOrThrow()
        : await trx.insertInto("invitations").values({
          tenant_id: tenant.id, email, phone_e164: phone, role: body.role, invited_by: auth.user.id, expires_at: expires,
        }).returningAll().executeTakeFirstOrThrow();
      await this.events.emit(trx, {
        type: "member.invited", tenantId: tenant.id, entity: { type: "invitation", id: row.id },
        actor: { type: "user", id: auth.user.id }, data: { role: body.role, channel: email ? "email" : "phone", refreshed: Boolean(pending) },
      });
      await this.audit.record(trx, {
        action: "member.invited", tenantId: tenant.id, ...auditActor(auth), entity: { type: "invitation", id: row.id },
        after: { role: body.role, channel: email ? "email" : "phone" },
      });
      return this.toInvitation(row);
    });
  }

  async revoke(auth: AuthContext, invitationId: string): Promise<void> {
    const tenantId = auth.tenant!.id;
    if (!/^[0-9a-f-]{36}$/i.test(invitationId)) throw new ProblemError(404, "invitation_not_found", "no pending invitation with this id");
    await this.db.tenant(tenantId, async (trx) => {
      const r = await trx.updateTable("invitations").set({ status: "revoked" })
        .where("id", "=", invitationId).where("status", "=", "pending").returning("role").executeTakeFirst();
      if (!r) throw new ProblemError(404, "invitation_not_found", "no pending invitation with this id");
      await this.audit.record(trx, {
        action: "member.invitation_revoked", tenantId, ...auditActor(auth), entity: { type: "invitation", id: invitationId }, before: { role: r.role },
      });
    });
  }

  /** Pending, unexpired invitations addressed to the signed-in user. */
  async mine(auth: AuthContext): Promise<MyInvitationView[]> {
    const contact = verifiedContact(auth);
    if (!contact.email && !contact.phone) return [];
    const rows = await this.db.platform(async (trx) => {
      await setActingUser(trx, auth.user.id, contact);
      return trx.selectFrom("invitations as i").innerJoin("tenants as t", "t.id", "i.tenant_id")
        .select(["i.id", "i.tenant_id", "t.name", "i.role", "i.expires_at"])
        .where("i.status", "=", "pending").where("i.expires_at", ">", new Date()).where("t.status", "in", ["trial", "active"])
        .orderBy("i.created_at").execute();
    });
    return rows.map((r) => ({ id: r.id, tenantId: r.tenant_id, tenantName: r.name, role: r.role, expiresAt: r.expires_at.toISOString() }));
  }

  /**
   * Accept an invitation addressed to the caller's verified email or phone.
   * Unknown id, someone else's invitation, revoked, accepted or expired all answer 404.
   */
  async accept(auth: AuthContext, invitationId: string): Promise<{ tenantId: string; role: string }> {
    const contact = verifiedContact(auth);
    if (!/^[0-9a-f-]{36}$/i.test(invitationId) || (!contact.email && !contact.phone)) throw notFound();
    const invite = await this.db.platform(async (trx) => {
      await setActingUser(trx, auth.user.id, contact);
      return trx.selectFrom("invitations").select(["id", "tenant_id"]).where("id", "=", invitationId)
        .where("status", "=", "pending").where("expires_at", ">", new Date()).executeTakeFirst();
    });
    if (!invite) throw notFound();

    return this.db.tenant(invite.tenant_id, async (trx) => {
      // Re-check inside the tenant transaction, locking the row: two accepts cannot both win.
      const row = await trx.selectFrom("invitations").select(["role"]).where("id", "=", invite.id)
        .where("status", "=", "pending").where("expires_at", ">", new Date()).forUpdate().executeTakeFirst();
      if (!row) throw notFound();
      await trx.insertInto("memberships").values({ tenant_id: invite.tenant_id, user_id: auth.user.id, role: row.role, status: "active" })
        .onConflict((oc) => oc.columns(["tenant_id", "user_id"]).doUpdateSet({ role: row.role, status: "active" }))
        .execute();
      await trx.updateTable("invitations").set({ status: "accepted", accepted_by: auth.user.id, accepted_at: new Date() })
        .where("id", "=", invite.id).execute();
      await this.events.emit(trx, {
        type: "member.joined", tenantId: invite.tenant_id, entity: { type: "member", id: auth.user.id },
        actor: { type: "user", id: auth.user.id }, data: { role: row.role, invitationId: invite.id },
      });
      await this.audit.record(trx, {
        action: "member.joined", tenantId: invite.tenant_id, ...auditActor(auth), entity: { type: "member", id: auth.user.id },
        after: { role: row.role, invitationId: invite.id },
      });
      return { tenantId: invite.tenant_id, role: row.role };
    });
  }

  /** Change role and/or status. Guards: not yourself, owners only by owners, never the last active owner. */
  async update(auth: AuthContext, userId: string, body: UpdateMemberBody): Promise<MemberView> {
    const tenant = auth.tenant!;
    if (userId === auth.user.id) throw new ProblemError(422, "cannot_change_self", "ask another owner or admin to change your own access");
    return this.db.tenant(tenant.id, async (trx) => {
      const target = await this.lockMember(trx, userId);
      const nextRole = (body.role ?? target.role) as MemberRole;
      const nextStatus = body.status ?? target.status;
      if ((target.role === "owner" || nextRole === "owner") && tenant.role !== "owner") {
        throw new ProblemError(403, "insufficient_role", "only an owner can change an owner or make someone owner");
      }
      if (target.role === "owner" && target.status === "active" && (nextRole !== "owner" || nextStatus !== "active")) {
        await this.assertAnotherOwner(trx, userId);
      }
      await trx.updateTable("memberships").set({ role: nextRole, status: nextStatus }).where("user_id", "=", userId).execute();
      await this.events.emit(trx, {
        type: "member.updated", tenantId: tenant.id, entity: { type: "member", id: userId }, actor: { type: "user", id: auth.user.id },
        data: { before: { role: target.role, status: target.status }, after: { role: nextRole, status: nextStatus } },
      });
      await this.audit.record(trx, {
        action: "member.updated", tenantId: tenant.id, ...auditActor(auth), entity: { type: "member", id: userId },
        before: { role: target.role, status: target.status }, after: { role: nextRole, status: nextStatus },
      });
      return this.memberView(trx, userId);
    });
  }

  async remove(auth: AuthContext, userId: string): Promise<void> {
    const tenant = auth.tenant!;
    if (userId === auth.user.id) throw new ProblemError(422, "cannot_change_self", "ask another owner or admin to remove you");
    await this.db.tenant(tenant.id, async (trx) => {
      const target = await this.lockMember(trx, userId);
      if (target.role === "owner") {
        if (tenant.role !== "owner") throw new ProblemError(403, "insufficient_role", "only an owner can remove an owner");
        if (target.status === "active") await this.assertAnotherOwner(trx, userId);
      }
      await trx.deleteFrom("memberships").where("user_id", "=", userId).execute();
      await this.events.emit(trx, {
        type: "member.removed", tenantId: tenant.id, entity: { type: "member", id: userId },
        actor: { type: "user", id: auth.user.id }, data: { role: target.role },
      });
      await this.audit.record(trx, {
        action: "member.removed", tenantId: tenant.id, ...auditActor(auth), entity: { type: "member", id: userId },
        before: { role: target.role, status: target.status },
      });
    });
  }

  private async lockMember(trx: Transaction<DB>, userId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new ProblemError(404, "member_not_found", "no member with this id");
    // Lock all owner rows too, so two concurrent demotions cannot remove the last owner.
    await trx.selectFrom("memberships").select("user_id").where("role", "=", "owner").forUpdate().execute();
    const target = await trx.selectFrom("memberships").select(["role", "status"]).where("user_id", "=", userId).forUpdate().executeTakeFirst();
    if (!target) throw new ProblemError(404, "member_not_found", "no member with this id");
    return target;
  }

  private async assertAnotherOwner(trx: Transaction<DB>, exceptUserId: string) {
    const others = await trx.selectFrom("memberships").select("user_id")
      .where("role", "=", "owner").where("status", "=", "active").where("user_id", "!=", exceptUserId).execute();
    if (others.length === 0) throw new ProblemError(422, "last_owner", "a store needs at least one active owner");
  }

  private async memberView(trx: Transaction<DB>, userId: string): Promise<MemberView> {
    const m = await trx.selectFrom("memberships as m").innerJoin("users as u", "u.id", "m.user_id")
      .select(["m.user_id", "m.role", "m.status", "m.created_at", "u.display_name", "u.email", "u.phone_e164"])
      .where("m.user_id", "=", userId).executeTakeFirstOrThrow();
    return { userId: m.user_id, displayName: m.display_name, email: m.email, phone: m.phone_e164, role: m.role, status: m.status, joinedAt: m.created_at.toISOString() };
  }

  private toInvitation(i: { id: string; email: string | null; phone_e164: string | null; role: string; status: string; expires_at: Date; created_at: Date }): InvitationView {
    return {
      id: i.id, email: i.email, phone: i.phone_e164, role: i.role, status: i.status,
      expiresAt: i.expires_at.toISOString(), createdAt: i.created_at.toISOString(), acceptUrl: this.acceptUrl(i.id),
    };
  }
}

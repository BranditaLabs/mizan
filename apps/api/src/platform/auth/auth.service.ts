import { Inject, Injectable } from "@nestjs/common";
import { setActingUser } from "@mizan/db";
import { isMemberRole, type MemberRole, type MembershipStatus } from "@mizan/shared";
import { APP_CONFIG, type AppConfig } from "../config.js";
import { TtlCache } from "../cache.js";
import { Database } from "../db/database.js";
import type { AuthUser } from "./auth.types.js";
import type { VerifiedIdentity } from "./token-verifier.js";

export interface MembershipView {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  tenantStatus: string;
  country: string;
  baseCurrency: string;
  locale: string;
  timezone: string;
  role: MemberRole;
  status: MembershipStatus;
}

type UserRow = { id: string; firebase_uid: string; email: string | null; phone_e164: string | null; display_name: string | null; language: string };

const toUser = (r: UserRow): AuthUser => ({
  id: r.id,
  firebaseUid: r.firebase_uid,
  email: r.email,
  phone: r.phone_e164,
  displayName: r.display_name,
  language: r.language === "en" ? "en" : "ar",
});

type MembershipCheck = Pick<MembershipView, "role" | "status" | "tenantStatus">;

/** Identity fields that, when they change in the token, must reach the users table. */
const profileOf = (i: VerifiedIdentity) => `${i.email ?? ""}|${i.phone ?? ""}|${i.name ?? ""}`;

@Injectable()
export class AuthService {
  /** Firebase uid → user, valid while the token's profile matches (H-6). */
  private readonly userCache: TtlCache<string, { user: AuthUser; profile: string }>;
  /** `${tenantId}:${userId}` → membership; null = not a member. */
  private readonly membershipCache: TtlCache<string, MembershipCheck | null>;

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.userCache = new TtlCache(config.AUTH_USER_CACHE_MS);
    this.membershipCache = new TtlCache(config.AUTH_MEMBERSHIP_CACHE_MS);
  }

  /** Forget cached memberships after a change (this instance at once; others within the TTL). */
  invalidateMembership(tenantId: string, userId?: string): void {
    if (userId) this.membershipCache.delete(`${tenantId}:${userId}`);
    else this.membershipCache.deleteWhere((k) => k.startsWith(`${tenantId}:`));
  }

  /**
   * The Mizan user for a verified identity, created on first sign-in.
   * Email/phone/name follow Firebase (the identity provider owns them).
   * Safe under concurrent first requests: the unique firebase_uid decides.
   */
  async resolveUser(identity: VerifiedIdentity): Promise<AuthUser> {
    const cached = this.userCache.get(identity.uid);
    if (cached && cached.profile === profileOf(identity)) return cached.user;
    const user = await this.loadUser(identity);
    this.userCache.set(identity.uid, { user, profile: profileOf(identity) });
    return user;
  }

  private async loadUser(identity: VerifiedIdentity): Promise<AuthUser> {
    return this.db.platform(async (trx) => {
      const profile = { email: identity.email ?? null, phone_e164: identity.phone ?? null, display_name: identity.name ?? null };
      const columns = ["id", "firebase_uid", "email", "phone_e164", "display_name", "language"] as const;
      let row = await trx.selectFrom("users").select(columns).where("firebase_uid", "=", identity.uid).executeTakeFirst();
      if (!row) {
        row = await trx.insertInto("users").values({ firebase_uid: identity.uid, ...profile })
          .onConflict((oc) => oc.column("firebase_uid").doNothing())
          .returning(columns).executeTakeFirst()
          ?? await trx.selectFrom("users").select(columns).where("firebase_uid", "=", identity.uid).executeTakeFirstOrThrow();
      } else if (row.email !== profile.email || row.phone_e164 !== profile.phone_e164 || (profile.display_name && row.display_name !== profile.display_name)) {
        row = await trx.updateTable("users")
          .set({ email: profile.email, phone_e164: profile.phone_e164, display_name: profile.display_name ?? row.display_name })
          .where("id", "=", row.id).returning(columns).executeTakeFirstOrThrow();
      }
      return toUser(row);
    });
  }

  /** The caller's membership in one tenant, or undefined (no membership, or no such tenant). */
  async membership(tenantId: string, userId: string): Promise<MembershipCheck | undefined> {
    const key = `${tenantId}:${userId}`;
    const cached = this.membershipCache.get(key);
    if (cached !== undefined) return cached ?? undefined;
    const found = await this.loadMembership(tenantId, userId);
    this.membershipCache.set(key, found ?? null);
    return found;
  }

  private async loadMembership(tenantId: string, userId: string): Promise<MembershipCheck | undefined> {
    const row = await this.db.tenant(tenantId, (trx) =>
      trx.selectFrom("memberships as m")
        .innerJoin("tenants as t", "t.id", "m.tenant_id")
        .select(["m.role", "m.status", "t.status as tenant_status"])
        .where("m.user_id", "=", userId)
        .executeTakeFirst());
    if (!row || !isMemberRole(row.role)) return undefined;
    return { role: row.role, status: row.status as MembershipStatus, tenantStatus: row.tenant_status };
  }

  /** Every membership of the user across tenants (GET /me). */
  async memberships(userId: string): Promise<MembershipView[]> {
    const rows = await this.db.platform(async (trx) => {
      await setActingUser(trx, userId);
      return trx.selectFrom("memberships as m")
        .innerJoin("tenants as t", "t.id", "m.tenant_id")
        .select([
          "m.tenant_id", "m.role", "m.status", "t.name", "t.slug", "t.status as tenant_status",
          "t.country", "t.base_currency", "t.locale", "t.timezone",
        ])
        .where("m.user_id", "=", userId)
        .where("t.status", "!=", "deleted")
        .orderBy("t.name")
        .execute();
    });
    return rows.filter((r) => isMemberRole(r.role)).map((r) => ({
      tenantId: r.tenant_id,
      tenantName: r.name,
      tenantSlug: r.slug,
      tenantStatus: r.tenant_status,
      country: r.country,
      baseCurrency: r.base_currency,
      locale: r.locale,
      timezone: r.timezone,
      role: r.role as MemberRole,
      status: r.status as MembershipStatus,
    }));
  }
}

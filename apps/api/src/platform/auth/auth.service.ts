import { Inject, Injectable } from "@nestjs/common";
import { setActingUser } from "@mizan/db";
import { isMemberRole, type MemberRole, type MembershipStatus } from "@mizan/shared";
import type { MembershipView } from "./membership.schema.js";
import { APP_CONFIG, type AppConfig } from "../config.js";
import { TtlCache } from "../cache.js";
import { ProblemError } from "../http/problem.js";
import { Database } from "../db/database.js";
import type { AuthUser, SupportGrant } from "./auth.types.js";
import type { VerifiedIdentity } from "./token-verifier.js";

export type { MembershipView } from "./membership.schema.js";

type UserRow = { id: string; firebase_uid: string; email: string | null; phone_e164: string | null; display_name: string | null; language: string; disabled_at: Date | null };

const toUser = (r: UserRow): AuthUser => ({
  id: r.id,
  firebaseUid: r.firebase_uid,
  email: r.email,
  phone: r.phone_e164,
  displayName: r.display_name,
  language: r.language === "en" ? "en" : "ar",
});

/** What the guard needs; tenantStatus includes "deleted" (the guard refuses it). */
type MembershipCheck = Pick<MembershipView, "role" | "status"> & { tenantStatus: string };

/** A sign-in through a company's identity provider (A-9): Firebase Identity Platform's SAML or OIDC providers. */
export const SSO_PROVIDER = /^(saml|oidc)\.[a-z0-9-]{1,60}$/;

/** The email's domain, lower-cased ("Sara@Acme.COM" → "acme.com"). */
export const emailDomain = (email: string | undefined) => email?.split("@").at(-1)?.trim().toLowerCase() || undefined;

/** Identity fields that, when they change in the token, must reach the users table. */
const profileOf = (i: VerifiedIdentity) => `${i.email ?? ""}|${i.phone ?? ""}|${i.name ?? ""}`;

@Injectable()
export class AuthService {
  /** Firebase uid → user, valid while the token's profile matches (H-6). */
  private readonly userCache: TtlCache<string, { user: AuthUser; profile: string; disabled: boolean }>;
  /** `${tenantId}:${userId}` → membership; null = not a member. */
  private readonly membershipCache: TtlCache<string, MembershipCheck | null>;
  /** Email domain → its enabled SSO provider; null = none. */
  private readonly ssoCache: TtlCache<string, string | null>;

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.userCache = new TtlCache(config.AUTH_USER_CACHE_MS);
    this.membershipCache = new TtlCache(config.AUTH_MEMBERSHIP_CACHE_MS);
    this.ssoCache = new TtlCache(config.AUTH_MEMBERSHIP_CACHE_MS);
  }

  /** The enabled SSO provider for an email domain (A-9), or null. Read before sign-in, so no tenant. */
  async ssoProvider(domain: string): Promise<string | null> {
    const cached = this.ssoCache.get(domain);
    if (cached !== undefined) return cached;
    const row = await this.db.platform((trx) => trx.selectFrom("sso_domains").select("provider_id")
      .where("domain", "=", domain).where("enabled", "=", true).executeTakeFirst());
    const provider = row?.provider_id ?? null;
    this.ssoCache.set(domain, provider);
    return provider;
  }

  /** Forget a cached domain after staff change it (this instance at once; others within the TTL). */
  forgetSso(domain: string): void {
    this.ssoCache.delete(domain);
  }

  /**
   * A token from a company's identity provider counts only for that company's domain: the provider
   * must be the one Mizan staff registered for the email's domain, and still enabled. Otherwise a
   * provider set up for one company could vouch for another company's people.
   */
  async checkSso(identity: VerifiedIdentity): Promise<void> {
    const domain = emailDomain(identity.email);
    if (!domain || (await this.ssoProvider(domain)) !== identity.signInProvider) {
      throw new ProblemError(401, "sso_domain_mismatch", "this company sign-in is not set up for your email's domain");
    }
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
    let entry = cached && cached.profile === profileOf(identity) ? cached : undefined;
    if (!entry) {
      entry = { ...(await this.loadUser(identity)), profile: profileOf(identity) };
      this.userCache.set(identity.uid, entry);
    }
    // A-5: Mizan staff stopped this person signing in; Firebase still knows them, Mizan does not answer.
    if (entry.disabled) throw new ProblemError(403, "user_disabled", "sign-in to Mizan is disabled for this account");
    return entry.user;
  }

  /** Forget a cached user after staff disable or enable them (this instance at once; others within the TTL). */
  forgetUser(firebaseUid: string): void {
    this.userCache.delete(firebaseUid);
  }

  private async loadUser(identity: VerifiedIdentity): Promise<{ user: AuthUser; disabled: boolean }> {
    return this.db.platform(async (trx) => {
      const profile = { email: identity.email ?? null, phone_e164: identity.phone ?? null, display_name: identity.name ?? null };
      const columns = ["id", "firebase_uid", "email", "phone_e164", "display_name", "language", "disabled_at"] as const;
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
      return { user: toUser(row), disabled: row.disabled_at !== null };
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

  /**
   * The open support grant of an active staff member in this store (A-3), write before read. Never
   * cached: a grant ends at its expiry, or when staff or the store end it, on the very next request.
   */
  async supportGrant(tenantId: string, userId: string): Promise<(SupportGrant & { tenantStatus: string }) | undefined> {
    const row = await this.db.staff((trx) => trx.selectFrom("support_access as a")
      .innerJoin("platform_staff as s", "s.id", "a.staff_id").innerJoin("tenants as t", "t.id", "a.tenant_id")
      .select(["a.id", "a.staff_id", "a.mode", "a.expires_at", "t.status"])
      .where("a.tenant_id", "=", tenantId).where("s.user_id", "=", userId).where("s.status", "=", "active")
      .where("a.ended_at", "is", null).where("a.expires_at", ">", new Date())
      .orderBy("a.mode", "desc").limit(1).executeTakeFirst());
    if (!row?.staff_id) return undefined;
    return { grantId: row.id, staffId: row.staff_id, mode: row.mode as "read" | "write", expiresAt: row.expires_at.toISOString(), tenantStatus: row.status };
  }

  /** One request made under a support grant, in the staff trail (the route, never ids or query strings). */
  async recordSupportCall(grant: SupportGrant, userId: string, tenantId: string, action: string, ip?: string): Promise<void> {
    await this.db.staff((trx) => trx.insertInto("platform_audit").values({
      staff_id: grant.staffId, user_id: userId, action: action.slice(0, 200), outcome: "ok", target_type: "support_access", target_id: grant.grantId,
      store_id: tenantId, ip: ip ?? null, data: JSON.stringify({ mode: grant.mode }),
    }).execute());
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
      tenantStatus: r.tenant_status as MembershipView["tenantStatus"], // CHECK constraint; deleted are filtered out above
      country: r.country,
      baseCurrency: r.base_currency,
      locale: r.locale,
      timezone: r.timezone,
      role: r.role as MemberRole,
      status: r.status as MembershipStatus,
    }));
  }
}

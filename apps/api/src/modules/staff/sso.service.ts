import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "../../platform/audit/audit.service.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { AuthService, emailDomain } from "../../platform/auth/auth.service.js";
import { Database } from "../../platform/db/database.js";
import { ProblemError } from "../../platform/http/problem.js";

/** Mailbox providers anyone can sign up to: never one company's domain. */
const PUBLIC_DOMAINS = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "icloud.com", "me.com", "proton.me", "protonmail.com", "aol.com", "gmx.com", "mail.com", "yandex.com"]);

type Row = { domain: string; provider_id: string; enabled: boolean; updated_at: Date };
const view = (r: Row) => ({ domain: r.domain, providerId: r.provider_id, enabled: r.enabled, updatedAt: r.updated_at.toISOString() });

/**
 * Company sign-in (A-9). Staff route a store's verified email domain to the identity provider set
 * up for it in Firebase Identity Platform; the sign-in screen asks which provider a work email uses.
 * Each change is written to the store's own audit log.
 */
@Injectable()
export class SsoService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  /** The provider for a work email, or 404 (the same answer for every domain without one). */
  async lookup(email: string) {
    const domain = emailDomain(email);
    const providerId = domain ? await this.auth.ssoProvider(domain) : null;
    if (!providerId) throw new ProblemError(404, "sso_not_configured", "company sign-in is not set up for this email; sign in with your email and password or Google");
    return { providerId };
  }

  async list(storeId: string) {
    return this.db.staff(async (trx) => {
      await this.store(trx, storeId);
      const rows = await trx.selectFrom("sso_domains").select(["domain", "provider_id", "enabled", "updated_at"]).where("store_id", "=", storeId).orderBy("domain").execute();
      return { data: rows.map(view) };
    });
  }

  async set(auth: AuthContext, storeId: string, domain: string, body: { providerId: string; enabled: boolean; reason: string }) {
    if (PUBLIC_DOMAINS.has(domain)) throw new ProblemError(422, "public_email_domain", "a public mailbox domain cannot belong to one company");
    const out = await this.db.staff(async (trx) => {
      await this.store(trx, storeId);
      const before = await trx.selectFrom("sso_domains").select(["store_id", "provider_id", "enabled"]).where("domain", "=", domain).forUpdate().executeTakeFirst();
      if (before && before.store_id !== storeId) throw new ProblemError(409, "domain_taken", "this domain already signs in to another store");
      const row = await trx.insertInto("sso_domains")
        .values({ domain, store_id: storeId, provider_id: body.providerId, enabled: body.enabled, staff_id: auth.staff!.id })
        .onConflict((oc) => oc.column("domain").doUpdateSet({ provider_id: body.providerId, enabled: body.enabled, staff_id: auth.staff!.id, updated_at: new Date() }))
        .returning(["domain", "provider_id", "enabled", "updated_at"]).executeTakeFirstOrThrow();
      if (!before || before.provider_id !== body.providerId || before.enabled !== body.enabled) {
        await this.audit.record(trx, {
          action: "store.sso_set", tenantId: storeId, actor: { type: "mizan_staff", id: auth.staff!.id }, entity: { type: "sso_domain", id: domain },
          before: before ? { providerId: before.provider_id, enabled: before.enabled } : undefined,
          after: { providerId: body.providerId, enabled: body.enabled, reason: body.reason },
        });
      }
      return view(row);
    });
    this.auth.forgetSso(domain);
    return out;
  }

  async remove(auth: AuthContext, storeId: string, domain: string, reason?: string) {
    await this.db.staff(async (trx) => {
      await this.store(trx, storeId);
      const gone = await trx.deleteFrom("sso_domains").where("domain", "=", domain).where("store_id", "=", storeId).returning(["provider_id"]).executeTakeFirst();
      if (!gone) throw new ProblemError(404, "not_found", "this store has no company sign-in for that domain");
      await this.audit.record(trx, {
        action: "store.sso_removed", tenantId: storeId, actor: { type: "mizan_staff", id: auth.staff!.id }, entity: { type: "sso_domain", id: domain },
        before: { providerId: gone.provider_id }, after: reason ? { reason } : undefined,
      });
    });
    this.auth.forgetSso(domain);
  }

  private async store(trx: Parameters<Parameters<Database["staff"]>[0]>[0], id: string) {
    const t = await trx.selectFrom("tenants").select("id").where("id", "=", id).executeTakeFirst();
    if (!t) throw new ProblemError(404, "not_found", "no such store");
  }
}

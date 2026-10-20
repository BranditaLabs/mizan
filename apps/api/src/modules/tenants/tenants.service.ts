import { randomBytes, randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { setActingUser } from "@mizan/db";
import { COUNTRY_DEFAULTS, type CountryCode } from "@mizan/shared";
import { Database } from "../../platform/db/database.js";
import { EventsService } from "../../platform/events/events.service.js";
import { ProblemError } from "../../platform/http/problem.js";
import type { CreateTenantBody, TenantView } from "./tenants.dto.js";

/** A user can own this many stores (abuse guard; raise per account on request). */
export const MAX_OWNED_TENANTS = 10;

const RESERVED_SLUGS = new Set(["www", "api", "app", "admin", "mizan", "brandita", "help", "status", "docs", "support", "billing"]);

const DEFAULT_WAREHOUSE = { ar: "المخزن الرئيسي", en: "Main warehouse" } as const;

/** "Nile Abayas & Co." → "nile-abayas-co"; Arabic-only names → "" (caller falls back to a random slug). */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

const suffix = () => randomBytes(3).toString("hex");
const isUniqueViolation = (err: unknown) => (err as { code?: string } | null)?.code === "23505";

type TenantRow = {
  id: string; name: string; slug: string; country: string; base_currency: string; timezone: string; locale: string;
  plan: string; status: string; settings: unknown; created_at: Date;
};

const toView = (t: TenantRow, role: string): TenantView => ({
  id: t.id,
  name: t.name,
  slug: t.slug,
  country: t.country,
  baseCurrency: t.base_currency,
  timezone: t.timezone,
  locale: t.locale,
  plan: t.plan,
  status: t.status,
  settings: (t.settings ?? {}) as Record<string, unknown>,
  createdAt: t.created_at.toISOString(),
  role,
});

@Injectable()
export class TenantsService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(EventsService) private readonly events: EventsService,
  ) {}

  /**
   * Signup: the store, its owner membership and a default warehouse, in one
   * transaction scoped to the new tenant (RLS applies from the first row).
   */
  async create(userId: string, body: CreateTenantBody): Promise<TenantView> {
    const owned = await this.db.platform(async (trx) => {
      await setActingUser(trx, userId);
      const r = await trx.selectFrom("memberships").select((eb) => eb.fn.countAll<number>().as("n"))
        .where("user_id", "=", userId).where("role", "=", "owner").executeTakeFirstOrThrow();
      return Number(r.n);
    });
    if (owned >= MAX_OWNED_TENANTS) {
      throw new ProblemError(422, "tenant_limit_reached", `an account can own up to ${MAX_OWNED_TENANTS} stores`);
    }

    const country = body.country as CountryCode;
    const defaults = COUNTRY_DEFAULTS[country];
    const locale = body.language === "en" ? `en-${country}` : defaults.locale;
    const settings = {
      weekStartsOn: defaults.weekStartsOn,
      ...("phoneCountry" in defaults ? { phoneCountry: defaults.phoneCountry } : {}),
    };

    if (body.slug && RESERVED_SLUGS.has(body.slug)) throw new ProblemError(409, "slug_taken", "this store address is taken");
    const base = slugify(body.name);
    const candidates = body.slug
      ? [body.slug]
      : [base.length >= 3 && !RESERVED_SLUGS.has(base) ? base : `store-${suffix()}`, ...Array.from({ length: 4 }, () => `${(base.length >= 3 ? base.slice(0, 33) : "store")}-${suffix()}`)];

    for (const slug of candidates) {
      const id = randomUUID();
      try {
        return await this.db.tenant(id, async (trx) => {
          const tenant = await trx.insertInto("tenants").values({
            id, name: body.name, slug, country, base_currency: defaults.currency, timezone: defaults.timezone, locale, settings: JSON.stringify(settings),
          }).returningAll().executeTakeFirstOrThrow();
          await trx.insertInto("memberships").values({ tenant_id: id, user_id: userId, role: "owner", status: "active" }).execute();
          await trx.insertInto("warehouses").values({ tenant_id: id, name: DEFAULT_WAREHOUSE[body.language], is_default: true }).execute();
          await this.events.emit(trx, {
            type: "tenant.created", tenantId: id, entity: { type: "tenant", id },
            actor: { type: "user", id: userId }, data: { country, plan: tenant.plan },
          });
          return toView(tenant, "owner");
        });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        if (body.slug) throw new ProblemError(409, "slug_taken", "this store address is taken");
      }
    }
    throw new ProblemError(409, "slug_taken", "could not find a free store address; choose one");
  }

  async get(tenantId: string, role: string): Promise<TenantView> {
    const tenant = await this.db.tenant(tenantId, (trx) => trx.selectFrom("tenants").selectAll().where("id", "=", tenantId).executeTakeFirstOrThrow());
    return toView(tenant, role);
  }
}

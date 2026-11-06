import { Inject, Injectable } from "@nestjs/common";
import type { ShopProfile } from "@mizan/engine";
import { AuditService } from "../platform/audit/audit.service.js";
import { Database } from "../platform/db/database.js";

/** What Mizan keeps of the store's brand (tenants.settings.brand), shown in the app's header and store switcher. */
export interface StoreBrand {
  source: "shopify";
  connectionId: string;
  logoUrl: string | null;
  squareLogoUrl: string | null;
  color: string | null;
  url: string | null;
  /** The name Shopify gave at the last read: the store follows it while nobody renamed it in Mizan. */
  shopName: string;
  /** The logo could be read; or the app may not read it yet (the merchant approves the storefront scope); or none is set. */
  access: ShopProfile["brand"];
  syncedAt: string;
}

const https = (u: string | undefined) => (u && /^https:\/\//i.test(u) ? u.slice(0, 1000) : null);

/**
 * The store's name and logo come from Shopify, not from typing (onboarding): read on connect and
 * daily, so a rename or a new logo in Shopify reaches Mizan. The name follows Shopify's until
 * someone renames the store in Mizan (then Mizan's stays). With several Shopify stores, the first
 * one connected names it; the others change nothing. A disconnected store changes nothing.
 * Idempotent: the same profile is a no-op (compared field by field: jsonb reorders keys).
 */
@Injectable()
export class StoreProfile {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async record(tenantId: string, connectionId: string, p: ShopProfile, now = new Date()): Promise<void> {
    await this.db.tenant(tenantId, async (trx) => {
      const c = await trx.selectFrom("connections").select("status").where("id", "=", connectionId).executeTakeFirst();
      if (!c || c.status === "disconnected") return;
      // One store names the brand: the first Shopify store connected (still connected). With two stores,
      // each daily read would otherwise rename it to the other's name.
      const primary = await trx.selectFrom("connections").select("id").where("kind", "=", "store").where("provider", "=", "shopify")
        .where("status", "!=", "disconnected").orderBy("created_at").orderBy("id").limit(1).executeTakeFirst();
      if (primary?.id !== connectionId) return;
      const t = await trx.selectFrom("tenants").select(["name", "settings"]).where("id", "=", tenantId).forUpdate().executeTakeFirstOrThrow();
      const settings = (t.settings ?? {}) as Record<string, unknown>;
      const before = settings.brand as Partial<StoreBrand> | undefined;
      // A logo read before stays when this read could not see it (the scope withdrawn, Shopify down for the storefront).
      const keep = p.brand === "no_access" && before?.connectionId === connectionId;
      const brand: StoreBrand = {
        source: "shopify", connectionId,
        logoUrl: keep ? before.logoUrl ?? null : https(p.logoUrl),
        squareLogoUrl: keep ? before.squareLogoUrl ?? null : https(p.squareLogoUrl),
        color: keep ? before.color ?? null : (p.brandColor && /^#[0-9a-f]{3,8}$/i.test(p.brandColor) ? p.brandColor : null),
        url: https(p.url), shopName: p.name.trim().slice(0, 80), access: p.brand, syncedAt: now.toISOString(),
      };
      // Shopify's name while the store still has the one it got at signup or from Shopify; a rename in Mizan wins.
      const follows = !before?.shopName || t.name === before.shopName;
      const name = follows && brand.shopName.length >= 2 ? brand.shopName : t.name;
      const FIELDS = ["source", "connectionId", "logoUrl", "squareLogoUrl", "color", "url", "shopName", "access"] as const;
      if (name === t.name && before && FIELDS.every((k) => (before[k] ?? null) === brand[k])) return;
      await trx.updateTable("tenants").set({ name, settings: JSON.stringify({ ...settings, brand }), updated_at: now }).where("id", "=", tenantId).execute();
      // storeName, not name: the audit masks `name` as a person's.
      await this.audit.record(trx, {
        action: "tenant.updated", tenantId, entity: { type: "tenant", id: tenantId },
        before: { storeName: t.name, logo: before?.logoUrl ?? null }, after: { storeName: name, logo: brand.logoUrl, access: brand.access, from: "shopify" }, actor: { type: "system" },
      });
    });
  }
}

import type { IconProps } from "@mizan/design-system/icons/react";

/**
 * The settings pages (U4), grouped the way people look for them, each with the roles that can
 * open it (the same as the page and its API). The side menu, the /settings overview and ⌘K read it.
 */
export type SettingsKey = "store" | "team" | "usage" | "audit" | "privacy" | "integrations" | "storeSync" | "orders" | "confirmation" | "offers"
  | "costs" | "payments" | "refunds" | "inventory" | "purchasing";
export type SettingsGroup = "brand" | "connections" | "orders" | "money" | "stock";

const OA = ["owner", "admin"] as const;
const OAM = ["owner", "admin", "ops_manager"] as const;

export interface SettingsPage { key: SettingsKey; href: string; group: SettingsGroup; icon: IconProps["name"]; roles: readonly string[] }

export const SETTINGS: readonly SettingsPage[] = [
  { key: "store", href: "/settings/store", group: "brand", icon: "settings", roles: OA },
  { key: "team", href: "/settings/team", group: "brand", icon: "team", roles: OA },
  { key: "usage", href: "/settings/usage", group: "brand", icon: "invoice", roles: [...OA, "finance"] },
  { key: "audit", href: "/settings/audit", group: "brand", icon: "note", roles: OA },
  { key: "privacy", href: "/settings/privacy", group: "brand", icon: "locked", roles: OA },
  { key: "integrations", href: "/settings/integrations", group: "connections", icon: "link", roles: OAM },
  { key: "storeSync", href: "/settings/store-sync", group: "connections", icon: "sync", roles: OA },
  { key: "orders", href: "/settings/orders", group: "orders", icon: "orders", roles: OAM },
  { key: "confirmation", href: "/settings/confirmation", group: "orders", icon: "verification", roles: OAM },
  { key: "offers", href: "/settings/offers", group: "orders", icon: "discount", roles: OAM },
  { key: "costs", href: "/settings/costs", group: "money", icon: "profit", roles: [...OAM, "finance"] },
  { key: "payments", href: "/settings/payments", group: "money", icon: "payments", roles: [...OAM, "finance"] },
  { key: "refunds", href: "/settings/refunds", group: "money", icon: "refund", roles: [...OAM, "finance"] },
  { key: "inventory", href: "/settings/inventory", group: "stock", icon: "warehouse", roles: OAM },
  { key: "purchasing", href: "/settings/purchasing", group: "stock", icon: "purchasing", roles: [...OAM, "finance"] },
];

export const SETTINGS_GROUPS: readonly SettingsGroup[] = ["brand", "connections", "orders", "money", "stock"];

export function settingsFor(role: string | undefined): SettingsPage[] {
  return role ? SETTINGS.filter((p) => p.roles.includes(role)) : [];
}

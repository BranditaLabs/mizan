import type { IconProps } from "@mizan/design-system/icons/react";
import { can, type Permission } from "@mizan/shared";

/**
 * The settings pages (U4), grouped the way people look for them, each with the roles that can
 * open it, as a permission (U6; the same as the page and its API). The side menu and the /settings overview read it.
 */
export type SettingsKey = "store" | "team" | "usage" | "audit" | "privacy" | "integrations" | "storeSync" | "orders" | "confirmation" | "offers"
  | "costs" | "payments" | "refunds" | "inventory" | "purchasing";
export type SettingsGroup = "brand" | "connections" | "orders" | "money" | "stock";

export interface SettingsPage { key: SettingsKey; href: string; group: SettingsGroup; icon: IconProps["name"]; can: Permission }

export const SETTINGS: readonly SettingsPage[] = [
  { key: "store", href: "/settings/store", group: "brand", icon: "settings", can: "store.manage" },
  { key: "team", href: "/settings/team", group: "brand", icon: "team", can: "team.manage" },
  { key: "usage", href: "/settings/usage", group: "brand", icon: "invoice", can: "billing.read" },
  { key: "audit", href: "/settings/audit", group: "brand", icon: "note", can: "audit.read" },
  { key: "privacy", href: "/settings/privacy", group: "brand", icon: "locked", can: "privacy.manage" },
  { key: "integrations", href: "/settings/integrations", group: "connections", icon: "link", can: "connections.read" },
  { key: "storeSync", href: "/settings/store-sync", group: "connections", icon: "sync", can: "connections.manage" },
  { key: "orders", href: "/settings/orders", group: "orders", icon: "orders", can: "orders.settings" },
  { key: "confirmation", href: "/settings/confirmation", group: "orders", icon: "verification", can: "confirmation.manage" },
  { key: "offers", href: "/settings/offers", group: "orders", icon: "discount", can: "offers.manage" },
  { key: "costs", href: "/settings/costs", group: "money", icon: "profit", can: "profit.read" },
  { key: "payments", href: "/settings/payments", group: "money", icon: "payments", can: "payments.settings.read" },
  { key: "refunds", href: "/settings/refunds", group: "money", icon: "refund", can: "refunds.read" },
  { key: "inventory", href: "/settings/inventory", group: "stock", icon: "warehouse", can: "inventory.settings" },
  { key: "purchasing", href: "/settings/purchasing", group: "stock", icon: "purchasing", can: "purchasing.plan" },
];

export const SETTINGS_GROUPS: readonly SettingsGroup[] = ["brand", "connections", "orders", "money", "stock"];

export function settingsFor(role: string | undefined): SettingsPage[] {
  return SETTINGS.filter((p) => can(role, p.can));
}

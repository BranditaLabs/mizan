import type { IconProps } from "@mizan/design-system/icons/react";
import { can, type Permission } from "@mizan/shared";
import { SETTINGS } from "./settings-nav";

/**
 * Where people go in the app (U3), in one place: the rail, the phone bar and ⌘K all read it. Each
 * section names the permissions that open it (U6; the same names the API's routes check), so nobody is shown a
 * door that opens on "not available for your role". A role may land somewhere else inside a
 * section (a media buyer's "Profit" is the ads page).
 */
export type NavKey = "home" | "orders" | "confirmation" | "tickets" | "shipping" | "products" | "warehouse" | "purchasing"
  | "payments" | "profit" | "reports" | "automations" | "settings";
export type NavGroup = "work" | "catalog" | "money";

/** Settings is there for whoever can open at least one settings page. */
const SETTINGS_PERMISSIONS: readonly Permission[] = [...new Set(SETTINGS.map((p) => p.can))];

export interface NavItem {
  key: NavKey;
  icon: IconProps["name"];
  href: string;
  /** What counts as "in this section" for the active mark (defaults to href). */
  section?: string;
  group: NavGroup | null;
  /** Open to members with any of these permissions (null: everyone). */
  can: readonly Permission[] | null;
  /** A different landing page for some roles. */
  landing?: Readonly<Record<string, { href: string; section?: string }>>;
  /** Words people type in ⌘K, both languages. */
  keywords: string;
}

export const NAV: readonly NavItem[] = [
  { key: "home", icon: "home", href: "/", group: null, can: null, keywords: "home dashboard الرئيسية البداية" },
  { key: "orders", icon: "orders", href: "/orders", group: "work", can: ["orders.read"], keywords: "orders أوردرات طلبات" },
  { key: "confirmation", icon: "verification", href: "/confirmation", group: "work", can: ["confirmation.work"], keywords: "confirmation calls call queue تأكيد مكالمات" },
  { key: "tickets", icon: "returns", href: "/tickets", group: "work", can: ["tickets.read"], keywords: "tickets complaints returns تذاكر شكاوى مرتجعات" },
  { key: "shipping", icon: "shipping", href: "/shipping", group: "work", can: ["shipments.read"], keywords: "shipping courier shipments شحن مندوب شحنات" },
  { key: "products", icon: "product", href: "/products", group: "catalog", can: ["products.read"], keywords: "products catalog منتجات" },
  { key: "warehouse", icon: "warehouse", href: "/stock", group: "catalog", can: ["stock.read"], keywords: "stock inventory warehouse مخزن مخزون" },
  { key: "purchasing", icon: "purchasing", href: "/purchasing", group: "catalog", can: ["purchasing.read"], keywords: "purchasing suppliers purchase orders مشتريات موردين" },
  { key: "payments", icon: "payments", href: "/payments", group: "money", can: ["payments.read"], keywords: "payments refunds disputes cod مدفوعات فلوس استرجاع" },
  { key: "profit", icon: "profit", href: "/profit", group: "money", can: ["profit.read", "ads.read"], landing: { media_buyer: { href: "/profit/ads" } }, keywords: "profit ads roas أرباح مكسب إعلانات" },
  { key: "reports", icon: "reports", href: "/reports", group: "money", can: ["reports.read"], keywords: "reports dashboards export تقارير" },
  { key: "automations", icon: "automations", href: "/automations", group: null, can: ["automations.manage"], keywords: "automations rules recipes أتمتة قواعد" },
  { key: "settings", icon: "settings", href: "/settings", group: null, can: SETTINGS_PERMISSIONS, keywords: "settings team integrations إعدادات فريق" },
];

export const NAV_GROUPS: readonly NavGroup[] = ["work", "catalog", "money"];

export type NavLink = Omit<NavItem, "landing"> & { section: string };

/** The sections this role can open, with their landing page for that role. */
export function navFor(role: string | undefined): NavLink[] {
  if (!role) return [];
  return NAV.filter((n) => n.can === null || n.can.some((p) => can(role, p))).map(({ landing, ...n }) => {
    const l = landing?.[role];
    return { ...n, href: l?.href ?? n.href, section: l?.section ?? n.section ?? l?.href ?? n.href };
  });
}

/** The phone bar's four places, most used first, per role. */
const PRIMARY: Readonly<Record<string, readonly NavKey[]>> = {
  owner: ["home", "orders", "confirmation", "profit"],
  admin: ["home", "orders", "confirmation", "profit"],
  ops_manager: ["home", "orders", "confirmation", "shipping"],
  agent: ["confirmation", "orders", "tickets", "home"],
  warehouse: ["warehouse", "shipping", "orders", "home"],
  finance: ["payments", "profit", "orders", "home"],
  media_buyer: ["profit", "home"],
};

export function primaryFor(role: string | undefined): NavLink[] {
  const mine = navFor(role);
  return (PRIMARY[role ?? ""] ?? ["home"]).map((k) => mine.find((n) => n.key === k)).filter((n): n is NavLink => Boolean(n)).slice(0, 4);
}

/** The open section for a path (Home only on "/"). */
export function activeKey(links: readonly NavLink[], pathname: string): NavKey | null {
  const on = (s: string) => (s === "/" ? pathname === "/" : pathname === s || pathname.startsWith(`${s}/`));
  return links.find((n) => on(n.section))?.key ?? null;
}

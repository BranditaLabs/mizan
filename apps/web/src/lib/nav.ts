import type { IconProps } from "@mizan/design-system/icons/react";

/**
 * Where people go in the app (U3), in one place: the rail, the phone bar and ⌘K all read it. Each
 * section names the roles that can open it, the same as the API's guards, so nobody is shown a
 * door that opens on "not available for your role". A role may land somewhere else inside a
 * section (a media buyer's "Profit" is the ads page).
 */
export type NavKey = "home" | "orders" | "confirmation" | "tickets" | "shipping" | "products" | "warehouse" | "purchasing"
  | "payments" | "profit" | "reports" | "automations" | "settings";
export type NavGroup = "work" | "catalog" | "money";

const ALL = ["owner", "admin", "ops_manager", "agent", "warehouse", "finance", "media_buyer"] as const;
const MANAGE = ["owner", "admin", "ops_manager"] as const;

export interface NavItem {
  key: NavKey;
  icon: IconProps["name"];
  href: string;
  /** What counts as "in this section" for the active mark (defaults to href). */
  section?: string;
  group: NavGroup | null;
  roles: readonly string[];
  /** A different landing page for some roles. */
  landing?: Readonly<Record<string, { href: string; section?: string }>>;
  /** Words people type in ⌘K, both languages. */
  keywords: string;
}

export const NAV: readonly NavItem[] = [
  { key: "home", icon: "home", href: "/", group: null, roles: ALL, keywords: "home dashboard الرئيسية البداية" },
  { key: "orders", icon: "orders", href: "/orders", group: "work", roles: ["owner", "admin", "ops_manager", "finance", "agent", "warehouse"], keywords: "orders أوردرات طلبات" },
  { key: "confirmation", icon: "verification", href: "/confirmation", group: "work", roles: [...MANAGE, "agent"], keywords: "confirmation calls call queue تأكيد مكالمات" },
  { key: "tickets", icon: "returns", href: "/tickets", group: "work", roles: ["owner", "admin", "ops_manager", "finance", "agent", "warehouse"], keywords: "tickets complaints returns تذاكر شكاوى مرتجعات" },
  { key: "shipping", icon: "shipping", href: "/shipping", group: "work", roles: ["owner", "admin", "ops_manager", "finance", "warehouse", "agent"], keywords: "shipping courier shipments شحن مندوب شحنات" },
  { key: "products", icon: "product", href: "/products", group: "catalog", roles: [...MANAGE, "finance"], keywords: "products catalog منتجات" },
  { key: "warehouse", icon: "warehouse", href: "/stock", group: "catalog", roles: [...MANAGE, "warehouse", "finance"], keywords: "stock inventory warehouse مخزن مخزون" },
  { key: "purchasing", icon: "purchasing", href: "/purchasing", group: "catalog", roles: [...MANAGE, "finance", "warehouse"], keywords: "purchasing suppliers purchase orders مشتريات موردين" },
  { key: "payments", icon: "payments", href: "/payments", group: "money", roles: [...MANAGE, "finance"], keywords: "payments refunds disputes cod مدفوعات فلوس استرجاع" },
  { key: "profit", icon: "profit", href: "/profit", group: "money", roles: [...MANAGE, "finance", "media_buyer"], landing: { media_buyer: { href: "/profit/ads" } }, keywords: "profit ads roas أرباح مكسب إعلانات" },
  { key: "reports", icon: "reports", href: "/reports", group: "money", roles: ["owner", "admin", "ops_manager", "finance", "agent", "warehouse"], keywords: "reports dashboards export تقارير" },
  { key: "automations", icon: "automations", href: "/automations", group: null, roles: MANAGE, keywords: "automations rules recipes أتمتة قواعد" },
  { key: "settings", icon: "settings", href: "/settings/costs", section: "/settings", group: null, roles: [...MANAGE, "finance", "media_buyer"],
    landing: { media_buyer: { href: "/settings/ads", section: "/settings" } }, keywords: "settings team integrations إعدادات فريق" },
];

export const NAV_GROUPS: readonly NavGroup[] = ["work", "catalog", "money"];

export type NavLink = Omit<NavItem, "landing"> & { section: string };

/** The sections this role can open, with their landing page for that role. */
export function navFor(role: string | undefined): NavLink[] {
  if (!role) return [];
  return NAV.filter((n) => n.roles.includes(role)).map(({ landing, ...n }) => {
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
  media_buyer: ["profit", "home", "settings"],
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

"use client";

import { Icon, type IconProps } from "@mizan/design-system/icons/react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";

type Key = "home" | "orders" | "confirmation" | "tickets" | "payments" | "products" | "shipping" | "warehouse" | "purchasing" | "profit" | "reports" | "automations" | "settings";
const NAV: ReadonlyArray<{ key: Key; icon: IconProps["name"]; href?: string; section?: string }> = [
  { key: "home", icon: "home", href: "/" }, { key: "orders", icon: "orders", href: "/orders" }, { key: "confirmation", icon: "verification", href: "/confirmation" },
  { key: "tickets", icon: "returns", href: "/tickets" }, { key: "payments", icon: "payments", href: "/payments" },
  { key: "products", icon: "product", href: "/products" },  { key: "shipping", icon: "shipping", href: "/shipping" }, { key: "warehouse", icon: "warehouse", href: "/stock" }, { key: "purchasing", icon: "purchasing", href: "/purchasing" }, { key: "profit", icon: "profit", href: "/profit" },
  { key: "reports", icon: "reports", href: "/reports" },  { key: "automations", icon: "automations", href: "/automations" },
  { key: "settings", icon: "settings", href: "/settings/costs", section: "/settings" },
];

/**
 * The rail's main menu on Mizan Glass (docs/glass.md "Navigation"): a glass indicator slides on a
 * spring to the open section, carrying the red point at its edge. Active from the path.
 */
export function NavLinks() {
  const t = useTranslations("shell");
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));
  const current = NAV.findIndex(({ href, section }) => href !== undefined && isActive(section ?? href));
  return (
    <nav aria-label={t("navLabel")} className="nav">
      {current >= 0 ? <span className="nav-ind" style={{ transform: `translateY(${current * 38}px)` }} aria-hidden="true" /> : null}
      {NAV.map(({ key, icon, href }, i) => {
        const label = t(`nav.${key}`);
        if (!href) {
          return (
            <span key={key} aria-disabled="true" className="nav-item opacity-60">
              <Icon name={icon} size={17} />
              {label}
              <span className="nav-count">{t("soon")}</span>
            </span>
          );
        }
        return (
          <Link key={key} href={href} aria-current={i === current ? "page" : undefined} className="nav-item active:scale-[0.98]">
            <Icon name={icon} size={17} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
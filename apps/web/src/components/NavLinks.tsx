"use client";

import { Icon, type IconProps } from "@mizan/design-system/icons/react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";

type Key = "home" | "orders" | "confirmation" | "shipping" | "warehouse" | "profit" | "settings";
const NAV: ReadonlyArray<{ key: Key; icon: IconProps["name"]; href?: string; section?: string }> = [
  { key: "home", icon: "home", href: "/" }, { key: "orders", icon: "orders", href: "/orders" }, { key: "confirmation", icon: "verification", href: "/confirmation" },
  { key: "shipping", icon: "shipping" }, { key: "warehouse", icon: "warehouse" }, { key: "profit", icon: "profit", href: "/profit" },
  { key: "settings", icon: "settings", href: "/settings/costs", section: "/settings" },
];

/** The rail's main menu. Built modules are links (active from the path); the rest say "soon". */
export function NavLinks() {
  const t = useTranslations("shell");
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));
  return (
    <nav aria-label={t("navLabel")} className="flex flex-col gap-0.5">
      {NAV.map(({ key, icon, href, section }) => {
        const label = t(`nav.${key}`);
        const base = "relative flex h-[34px] items-center gap-2.5 rounded-sm px-3 text-label";
        if (!href) {
          return (
            <span key={key} aria-disabled="true" className={`${base} text-rail-text-2`}>
              <Icon name={icon} size={17} />
              {label}
              <span className="ms-auto rounded-full bg-rail-line px-2 text-caption">{t("soon")}</span>
            </span>
          );
        }
        const active = isActive(section ?? href);
        return (
          <Link key={key} href={href} aria-current={active ? "page" : undefined}
            className={`${base} ${active ? "bg-rail-surface text-white before:absolute before:inset-y-1.5 before:start-0 before:w-0.5 before:rounded-full before:bg-rail-active" : "hover:bg-rail-surface hover:text-white"}`}>
            <Icon name={icon} size={17} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

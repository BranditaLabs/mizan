"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { Link, usePathname } from "@/i18n/navigation";

const PAGES = [{ key: "store", href: "/settings/store" }, { key: "team", href: "/settings/team" }, { key: "integrations", href: "/settings/integrations" }, { key: "orders", href: "/settings/orders" }, { key: "costs", href: "/settings/costs" }, { key: "confirmation", href: "/settings/confirmation" }, { key: "offers", href: "/settings/offers" }, { key: "ads", href: "/settings/ads" }, { key: "refunds", href: "/settings/refunds" }, { key: "payments", href: "/settings/payments" }, { key: "purchasing", href: "/settings/purchasing" }, { key: "storeSync", href: "/settings/store-sync" }, { key: "usage", href: "/settings/usage" }, { key: "privacy", href: "/settings/privacy" }, { key: "audit", href: "/settings/audit" }] as const;

/** The settings pages, as links styled like tabs (each page has its own URL; the current one is aria-current). */
export function SettingsTabs() {
  const t = useTranslations("settings");
  const pathname = usePathname();
  const nav = useRef<HTMLElement>(null);
  // The open page's tab is always in view when the row is wider than the screen.
  useEffect(() => { nav.current?.querySelector<HTMLElement>("[aria-current=page]")?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [pathname]);
  return (
    <nav ref={nav} aria-label={t("label")} className="mz-tabs">
      {PAGES.map((p) => (
        <Link key={p.key} href={p.href} className="mz-tab" aria-current={pathname === p.href ? "page" : undefined}>
          {t(`pages.${p.key}`)}
        </Link>
      ))}
    </nav>
  );
}

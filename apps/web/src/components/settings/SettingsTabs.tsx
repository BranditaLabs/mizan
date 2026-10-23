"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";

const PAGES = [{ key: "costs", href: "/settings/costs" }, { key: "confirmation", href: "/settings/confirmation" }, { key: "offers", href: "/settings/offers" }, { key: "ads", href: "/settings/ads" }] as const;

/** The settings pages, as links styled like tabs (each page has its own URL; the current one is aria-current). */
export function SettingsTabs() {
  const t = useTranslations("settings");
  const pathname = usePathname();
  return (
    <nav aria-label={t("label")} className="mz-tabs">
      {PAGES.map((p) => (
        <Link key={p.key} href={p.href} className="mz-tab" aria-current={pathname === p.href ? "page" : undefined}>
          {t(`pages.${p.key}`)}
        </Link>
      ))}
    </nav>
  );
}

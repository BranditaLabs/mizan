import { Icon, type IconProps } from "@mizan/design-system/icons/react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import type { Theme } from "@/lib/theme";
import { LocaleSwitch } from "./LocaleSwitch";
import { StoreSwitcher, UserMenu } from "./StoreSwitcher";
import { ThemeSwitch } from "./ThemeSwitch";
import { ThemedWordmark, Wordmark } from "./Wordmark";

const NAV: ReadonlyArray<{ key: "home" | "orders" | "confirmation" | "shipping" | "warehouse" | "profit" | "settings"; icon: IconProps["name"] }> = [
  { key: "home", icon: "home" }, { key: "orders", icon: "orders" }, { key: "confirmation", icon: "verification" },
  { key: "shipping", icon: "shipping" }, { key: "warehouse", icon: "warehouse" }, { key: "profit", icon: "profit" },
  { key: "settings", icon: "settings" },
];

/**
 * App frame (packages/design-system/docs/components.md §1): ink rail 232px on the start side,
 * header 56px, page up to 1440px. Red appears only on the logo's point and the active indicator.
 */
export function Shell({ children, theme, active }: { children: ReactNode; theme: Theme; active: (typeof NAV)[number]["key"] }) {
  const t = useTranslations("shell");
  return (
    <div className="grid h-dvh grid-cols-1 lg:grid-cols-[232px_minmax(0,1fr)]">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded-sm focus:bg-surface focus:px-3 focus:py-2">{t("skip")}</a>
      <aside className="hidden min-h-0 flex-col overflow-y-auto bg-rail-bg px-3 py-5 text-rail-text lg:flex">
        <div className="px-3 pb-6">
          <Wordmark onDark />
          <p className="mt-2 text-caption text-rail-text-2">{t("tagline")}</p>
        </div>
        <div className="mx-3 mb-5 border-b border-rail-line pb-4">
          <StoreSwitcher rail />
        </div>
        <nav aria-label={t("navLabel")} className="flex flex-col gap-0.5">
          {NAV.map(({ key, icon }) => {
            const label = t(`nav.${key}`);
            const base = "relative flex h-[34px] items-center gap-2.5 rounded-sm px-3 text-label";
            if (key !== "home") {
              return (
                <span key={key} aria-disabled="true" className={`${base} text-rail-text-2`}>
                  <Icon name={icon} size={17} />
                  {label}
                  <span className="ms-auto rounded-full bg-rail-line px-2 text-caption">{t("soon")}</span>
                </span>
              );
            }
            return (
              <Link key={key} href="/" aria-current={active === key ? "page" : undefined}
                className={`${base} ${active === key ? "bg-rail-surface text-white before:absolute before:inset-y-1.5 before:start-0 before:w-0.5 before:rounded-full before:bg-rail-active" : "hover:bg-rail-surface hover:text-white"}`}>
                <Icon name={icon} size={17} />
                {label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-bg px-4 md:px-6">
          <ThemedWordmark className="shrink-0 lg:hidden" />
          <span className="hidden min-w-0 max-w-[30vw] sm:block lg:hidden"><StoreSwitcher /></span>
          <span className="flex-1" />
          <LocaleSwitch />
          <span className="hidden md:contents"><ThemeSwitch initial={theme} /></span>
          <UserMenu />
        </header>
        <main id="main" className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

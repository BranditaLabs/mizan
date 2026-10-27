import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import type { Theme } from "@/lib/theme";
import { LocaleSwitch } from "./LocaleSwitch";
import { NavLinks } from "./NavLinks";
import { NotificationBell } from "./NotificationBell";
import { PlanBanner } from "./PlanBanner";
import { AnnouncementsBanner } from "./AnnouncementsBanner";
import { ShellCommands } from "./ShellCommands";
import { SupportBanner } from "./SupportBanner";
import { StoreSwitcher, UserMenu } from "./StoreSwitcher";
import { ThemeSwitch } from "./ThemeSwitch";
import { ThemedWordmark, Wordmark } from "./Wordmark";

/**
 * App frame (packages/design-system/docs/components.md §1): ink rail 232px on the start side,
 * header 56px, page up to 1440px. Red appears only on the logo's point and the active indicator.
 */
export function Shell({ children, theme }: { children: ReactNode; theme: Theme }) {
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
        <NavLinks />
      </aside>
      <div className="flex min-h-0 min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-bg px-4 md:px-6">
          <ThemedWordmark className="shrink-0 lg:hidden" />
          <span className="hidden min-w-0 max-w-[30vw] sm:block lg:hidden"><StoreSwitcher /></span>
          <ShellCommands />
          <span className="flex-1" />
          <NotificationBell />
          <LocaleSwitch />
          <span className="hidden md:contents"><ThemeSwitch initial={theme} /></span>
          <UserMenu />
        </header>
        <AnnouncementsBanner />
        <SupportBanner />
        <PlanBanner />
        <main id="main" className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

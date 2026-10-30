import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import type { Theme } from "@/lib/theme";
import { LocaleSwitch } from "./LocaleSwitch";
import { NavLinks } from "./NavLinks";
import { NotificationBell } from "./NotificationBell";
import { PlanBanner } from "./PlanBanner";
import { RouteMotion } from "./RouteMotion";
import { AnnouncementsBanner } from "./AnnouncementsBanner";
import { ShellCommands } from "./ShellCommands";
import { SupportBanner } from "./SupportBanner";
import { StoreSwitcher, UserMenu } from "./StoreSwitcher";
import { ThemeSwitch } from "./ThemeSwitch";
import { ThemedWordmark } from "./Wordmark";
import { GlassRoot } from "./GlassRoot";

/**
 * App frame on Mizan Glass (docs/glass.md): a glass rail on the start side and a glass bar on top,
 * floating over the light fields; page up to 1440px. Red appears only on the logo's point and the
 * active indicator.
 */
export function Shell({ children, theme }: { children: ReactNode; theme: Theme }) {
  const t = useTranslations("shell");
  return (
    <GlassRoot theme={theme} className="h-dvh print:h-auto">
    <div className="grid h-dvh grid-cols-1 gap-3 lg:grid-cols-[248px_minmax(0,1fr)] lg:p-3 print:block print:h-auto">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded-sm focus:bg-surface focus:px-3 focus:py-2">{t("skip")}</a>
      <aside className="g hidden print:hidden min-h-0 flex-col overflow-hidden pt-5 text-rail-text lg:flex">
        <div className="px-6 pb-6">
          <ThemedWordmark />
          <p className="mt-2 text-caption text-rail-text-2">{t("tagline")}</p>
        </div>
        <div className="mx-6 mb-3 border-b border-rail-line pb-4">
          <StoreSwitcher rail />
        </div>
        {/* Only the menu scrolls, like a native list; the brand and the store stay put. */}
        <div className="mz-scroll min-h-0 flex-1 px-3 pb-4"><NavLinks /></div>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-col print:block">
        <header className="g print:hidden sticky top-0 z-30 mx-3 mt-3 flex h-14 items-center gap-3 px-4 md:px-5 lg:mx-0 lg:mt-0">
          <ThemedWordmark className="shrink-0 lg:hidden" />
          <span className="hidden min-w-0 max-w-[30vw] sm:block lg:hidden"><StoreSwitcher /></span>
          <ShellCommands />
          <span className="flex-1" />
          <NotificationBell />
          <LocaleSwitch />
          <span className="hidden md:contents"><ThemeSwitch initial={theme} /></span>
          <UserMenu />
        </header>
        <div className="contents print:hidden">
          <AnnouncementsBanner />
          <SupportBanner />
          <PlanBanner />
        </div>
        <main id="main" className="min-h-0 flex-1 overflow-y-auto print:overflow-visible"><RouteMotion>{children}</RouteMotion></main>
      </div>
    </div>
    </GlassRoot>
  );
}

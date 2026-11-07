import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import type { Theme } from "@/lib/theme";
import { LocaleSwitch } from "./LocaleSwitch";
import { NavLinks } from "./NavLinks";
import { MobileNav } from "./MobileNav";
import { FeedbackButton } from "./FeedbackButton";
import { NotificationBell } from "./NotificationBell";
import { PlanBanner } from "./PlanBanner";
import { SyncIndicator } from "./SyncIndicator";
import { SetupChecklist } from "./onboarding/SetupChecklist";
import { RouteMotion } from "./RouteMotion";
import { AnnouncementsBanner } from "./AnnouncementsBanner";
import { ShellCommands } from "./ShellCommands";
import { SupportBanner } from "./SupportBanner";
import { LegalBanner } from "./legal/LegalGate";
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
    <GlassRoot theme={theme} className="app-shell min-h-dvh print:min-h-0">
    {/* The page scrolls, not a panel inside it: links land at the top, the browser keeps each page's
        place on Back, phones can hide their address bar, and there is one scrollbar. */}
    <div className="grid min-h-dvh grid-cols-1 gap-3 lg:grid-cols-[248px_minmax(0,1fr)] lg:items-start lg:p-3 print:block print:min-h-0">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded-sm focus:bg-surface focus:px-3 focus:py-2">{t("skip")}</a>
      <aside className="g hidden print:hidden min-h-0 flex-col overflow-hidden pt-5 text-rail-text lg:sticky lg:top-3 lg:flex lg:h-[calc(100dvh-24px)]">
        <div className="px-6 pb-6">
          <ThemedWordmark tone="mono" />
          <p className="mt-2 text-caption text-rail-text-2">{t("tagline")}</p>
        </div>
        <div className="mx-6 mb-3 border-b border-rail-line pb-4">
          <StoreSwitcher rail />
        </div>
        <SetupChecklist />
        {/* Only the menu scrolls, like a native list; the brand and the store stay put. */}
        <div className="mz-scroll min-h-0 flex-1 px-3 pb-4"><NavLinks /></div>
      </aside>
      <div className="flex min-w-0 flex-col print:block">
        <header className="g print:hidden sticky top-3 z-30 mx-3 mt-3 flex h-14 items-center gap-2 px-3 sm:px-4 md:gap-3 md:px-5 lg:mx-0 lg:mt-0">
          <ThemedWordmark tone="mono" className="shrink-0 lg:hidden" />
          <span className="hidden min-w-0 max-w-[30vw] sm:block lg:hidden"><StoreSwitcher /></span>
          <ShellCommands />
          <span className="flex-1" />
          <SyncIndicator />
          <FeedbackButton />
          <NotificationBell />
          <LocaleSwitch />
          <span className="hidden md:contents"><ThemeSwitch initial={theme} /></span>
          <UserMenu />
        </header>
        <div className="contents print:hidden">
          <AnnouncementsBanner />
          <SupportBanner />
          <PlanBanner />
          <LegalBanner />
        </div>
        {/* Below lg the phone bar covers the bottom: the page scrolls clear of it. */}
        <main id="main" className="flex-1 pb-[calc(88px+env(safe-area-inset-bottom,0px))] lg:pb-0 print:pb-0"><RouteMotion>{children}</RouteMotion></main>
        <MobileNav />
      </div>
    </div>
    </GlassRoot>
  );
}

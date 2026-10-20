import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import type { Theme } from "@/lib/theme";
import { LocaleSwitch } from "./LocaleSwitch";
import { ThemeSwitch } from "./ThemeSwitch";

const NAV = ["home", "orders", "confirmation", "shipping", "warehouse", "profit", "settings"] as const;

/** Mizan's mark: the scale, drawn so it reads the same in both directions. */
function Mark() {
  return (
    <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path d="M16 7v18M9 25h14M8 12h16M8 12l-3 7h6zM24 12l-3 7h6z" stroke="var(--on-accent)" strokeWidth="1.8" fill="none" strokeLinejoin="round" />
    </svg>
  );
}

/** App frame from design/prototype.html: ink rail on the start side, workspace with a sticky top bar. */
export function Shell({ children, theme, active }: { children: ReactNode; theme: Theme; active: (typeof NAV)[number] }) {
  const t = useTranslations("shell");
  return (
    <div className="grid h-dvh grid-cols-1 lg:grid-cols-[248px_minmax(0,1fr)]">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2">{t("skip")}</a>
      <aside className="hidden min-h-0 flex-col overflow-y-auto bg-rail px-3 py-[18px] text-rail-ink lg:flex">
        <div className="flex items-center gap-2.5 px-2.5 pb-[18px]">
          <Mark />
          <div>
            <b className="block font-display text-[21px] font-bold tracking-tight text-white">{t("brand")}</b>
            <small className="block text-[10.5px] text-rail-dim">{t("tagline")}</small>
          </div>
        </div>
        <nav aria-label={t("navLabel")} className="flex flex-col gap-px">
          {NAV.map((item) => item === "home" ? (
            <Link key={item} href="/" aria-current={active === item ? "page" : undefined}
              className={`relative flex items-center gap-[11px] rounded-lg px-3 py-2 text-[13.5px] ${active === item ? "bg-rail-2 font-semibold text-white before:absolute before:inset-y-2 before:-start-3 before:w-[3px] before:rounded-sm before:bg-accent" : "hover:bg-rail-2 hover:text-white"}`}>
              {t(`nav.${item}`)}
            </Link>
          ) : (
            <span key={item} aria-disabled="true" className="flex items-center gap-[11px] rounded-lg px-3 py-2 text-[13.5px] text-rail-dim">
              {t(`nav.${item}`)}
              <span className="ms-auto rounded-full bg-rail-line px-[7px] py-px text-[11px]">{t("soon")}</span>
            </span>
          ))}
        </nav>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex h-[62px] items-center gap-3 border-b border-line bg-bg/85 px-6 backdrop-blur">
          <span className="flex items-center gap-2 font-display text-lg font-bold lg:hidden"><Mark />{t("brand")}</span>
          <span className="flex-1" />
          <LocaleSwitch />
          <ThemeSwitch initial={theme} />
        </header>
        <main id="main" className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

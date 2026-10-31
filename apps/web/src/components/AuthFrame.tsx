import { useTranslations } from "next-intl";
import type { CSSProperties, ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { legalPath } from "@/lib/legal";
import type { Theme } from "@/lib/theme";
import { LocaleSwitch } from "./LocaleSwitch";
import { ThemeSwitch } from "./ThemeSwitch";
import { ThemedWordmark } from "./Wordmark";
import { GlassRoot } from "./GlassRoot";
import { LanguageToggle, ThemeToggle } from "./auth/Toggles";
import { BrandPanel } from "./auth/BrandPanel";

/**
 * Frame for pages outside a store (sign-in, two-step, welcome): the wordmark and the language and
 * theme switches on top, one column of content in the middle. Mobile first: full width under 480px.
 */
export function AuthFrame({ theme, children }: { theme: Theme; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="flex h-14 items-center gap-3 px-4 md:px-6">
        <ThemedWordmark />
        <span className="flex-1" />
        <span className="hidden sm:contents"><LocaleSwitch /></span>
        <ThemeSwitch initial={theme} />
      </header>
      <main id="main" className="flex flex-1 justify-center px-4 pt-6 pb-14 sm:pt-14">
        <div className="w-full max-w-[420px]">{children}</div>
      </main>
      <footer className="flex justify-center pb-6 sm:hidden"><LocaleSwitch /></footer>
    </div>
  );
}

/**
 * The frame of every screen before a store (sign-in, two-step, welcome), as the "Sign in · glass"
 * board of the Mizan Glass canvas: on the start side the wordmark, a language and a theme button,
 * the step in a glass card and the footer; on the end side the brand panel. The brand panel steps
 * aside under 900px. Theme and direction come from GlassRoot.
 */
export function AuthSplit({ theme, children }: { theme: Theme; children: ReactNode }) {
  const t = useTranslations("auth");
  return (
    <GlassRoot theme={theme} className="min-h-dvh">
      <div className="flex min-h-dvh flex-wrap gap-4 p-[clamp(8px,2vh,16px)]">
        <div className="flex min-w-0 flex-[1_1_440px] flex-col px-2 py-[clamp(8px,2.2vh,20px)] sm:px-[clamp(8px,4vw,56px)]">
          <header className="flex items-center justify-between gap-3">
            <ThemedWordmark />
            <div className="flex gap-2">
              <LanguageToggle />
              <ThemeToggle initial={theme} />
            </div>
          </header>
          <main id="main" className="grid flex-1 place-items-center py-[clamp(10px,3vh,40px)]">
            <div className="g g-lift rise auth-card flex w-full max-w-[440px] flex-col gap-(--_gap) px-[clamp(20px,4vw,36px)] py-[clamp(20px,3.6vh,36px)]">{children}</div>
          </main>
          <footer className="faint flex flex-wrap justify-between gap-3 text-caption [@media(max-height:680px)]:hidden">
            <span>{t("footer.rights")}</span>
            <nav aria-label={t("footer.legal")} className="flex gap-4">
              {(["privacy", "terms", "dpa"] as const).map((d) => (
                <Link key={d} href={legalPath(d)} className="hover:underline hover:underline-offset-2">{t(`footer.${d}`)}</Link>
              ))}
            </nav>
          </footer>
        </div>
        <aside className="g auth-brand rise flex min-w-0 flex-[1.15_1_520px] flex-col justify-between gap-[clamp(12px,2vh,24px)] p-[clamp(24px,5vh,48px)]" style={{ "--d": ".1s" } as CSSProperties}>
          <BrandPanel />
        </aside>
      </div>
    </GlassRoot>
  );
}
/** A titled card inside AuthFrame (flat: border, no shadow). */
export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-surface p-5 sm:p-6">
      <h1 className="font-display text-heading-md">{title}</h1>
      {subtitle ? <p className="mt-1.5 text-body-sm text-text-2">{subtitle}</p> : null}
      <div className="mt-5 flex flex-col gap-4">{children}</div>
    </section>
  );
}

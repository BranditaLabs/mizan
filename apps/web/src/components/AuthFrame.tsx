import type { ReactNode } from "react";
import type { Theme } from "@/lib/theme";
import { LocaleSwitch } from "./LocaleSwitch";
import { ThemeSwitch } from "./ThemeSwitch";
import { ThemedWordmark } from "./Wordmark";
import { GlassRoot } from "./GlassRoot";

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
 * The sign-in screen's frame: the form on the paper side (start), the brand on the ink side (end)
 * with a sample order moving to cash (Showcase). Below 1024px the form comes first and the sample
 * order follows it, compact. The ink side is an aside, outside `main`.
 */
export function AuthSplit({ theme, showcase, compactShowcase, children }: { theme: Theme; showcase: ReactNode; compactShowcase: ReactNode; children: ReactNode }) {
  return (
    <GlassRoot theme={theme}>
    <div className="grid min-h-dvh grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <div className="flex min-h-dvh flex-col">
        <header className="flex h-16 items-center gap-3 px-4 md:px-8">
          <ThemedWordmark className="shrink-0 lg:invisible" />
          <span className="flex-1" />
          <LocaleSwitch />
          <span className="hidden sm:contents"><ThemeSwitch initial={theme} /></span>
        </header>
        <main id="main" className="flex flex-1 items-center justify-center px-4 pt-4 pb-10 md:px-8">
          <div className="g w-full max-w-[440px] p-6 sm:p-8">{children}</div>
        </main>
        <div className="px-4 pb-8 lg:hidden">
          <GlassRoot ink fields={false} className="g mx-auto max-w-[400px] overflow-hidden p-2 text-rail-text">{compactShowcase}</GlassRoot>
        </div>
      </div>
      <aside className="sticky top-0 hidden h-dvh p-3 text-rail-text lg:block">
        <GlassRoot ink className="g h-full overflow-hidden">{showcase}</GlassRoot>
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

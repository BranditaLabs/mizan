import type { ReactNode } from "react";
import type { Theme } from "@/lib/theme";
import { LocaleSwitch } from "./LocaleSwitch";
import { ThemeSwitch } from "./ThemeSwitch";
import { ThemedWordmark } from "./Wordmark";

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

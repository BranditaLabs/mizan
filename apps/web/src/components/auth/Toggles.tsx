"use client";

import { Icon } from "@mizan/design-system/icons/react";
import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { chooseTheme, type Theme } from "@/lib/theme";
import { useTheme } from "../ThemeProvider";

/** The other language, as one glass button showing its name ("عربي" on English pages, "English" on Arabic ones). */
export function LanguageToggle() {
  const t = useTranslations("shell.language");
  const locale = useLocale() as Locale;
  const other: Locale = locale === "ar" ? "en" : "ar";
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  return (
    <button type="button" className="btn btn-glass btn-sm" lang={other} aria-busy={pending || undefined}
      onClick={() => startTransition(() => router.replace(pathname, { locale: other }))}>
      <Icon name="language" size={16} />
      {t(other)}
    </button>
  );
}

const DARK = "(prefers-color-scheme: dark)";
const resolved = (theme: Theme) => (theme === "system" ? (window.matchMedia(DARK).matches ? "dark" : "light") : theme);

/** Light or dark in one press: from the theme in force (the person's choice, or the system's) to the other. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the prop stays for callers; ThemeProvider is the one source
export function ThemeToggle(_: { initial?: Theme }) {
  const t = useTranslations("auth");
  const theme = useTheme();
  return (
    <button type="button" className="btn btn-glass btn-sm btn-icon" aria-label={t("switchTheme")}
      onClick={() => chooseTheme(resolved(theme) === "dark" ? "light" : "dark")}>
      <Icon name="theme-dark" size={16} />
    </button>
  );
}

import type { Metadata } from "next";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { dirOf, routing } from "@/i18n/routing";
import { parseTheme, THEME_COOKIE, themeAttribute } from "@/lib/theme";
import { fontVariables } from "../fonts";
import "../globals.css";

type Props = { children: ReactNode; params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta" });
  return { title: t("title"), description: t("description") };
}

/** Root layout per language: <html lang dir> from the locale, theme from the cookie (no flash). */
export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const theme = themeAttribute(parseTheme((await cookies()).get(THEME_COOKIE)?.value));
  return (
    <html lang={locale} dir={dirOf(locale)} data-theme={theme} className={fontVariables} suppressHydrationWarning>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}

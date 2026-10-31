import type { Metadata } from "next";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { dirOf, routing } from "@/i18n/routing";
import { ToastProvider } from "@/components/ui/Toast";
import { QueryProvider } from "@/lib/api/query";
import { SessionProvider } from "@/lib/session";
import { parseTheme, THEME_COOKIE, themeAttribute } from "@/lib/theme";
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
  // The public landing page has its own root layout ((marketing)); its copy stays out of the dashboard.
  const messages = Object.fromEntries(Object.entries(await getMessages()).filter(([ns]) => ns !== "landing"));
  return (
    <html lang={locale} dir={dirOf(locale)} data-theme={theme} suppressHydrationWarning>
      <body>
        <NextIntlClientProvider messages={messages}>
          <ToastProvider>
            <QueryProvider>
              <SessionProvider>{children}</SessionProvider>
            </QueryProvider>
          </ToastProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

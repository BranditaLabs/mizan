import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { dirOf, routing } from "@/i18n/routing";
import "../../globals.css";

type Props = { children: ReactNode; params: Promise<{ locale: string }> };

/** Both languages are built ahead of time; the public pages read no cookie on the server. */
export const generateStaticParams = () => routing.locales.map((locale) => ({ locale }));

/**
 * Root layout of the public marketing pages (the landing page, L1-9): its own <html>, without the
 * dashboard's session, query and toast providers, so a visitor downloads no Firebase or API client and
 * the page can be prerendered. Only the "landing" messages reach the browser. The theme is applied on
 * the client (LandingRoot), so no cookie is read here.
 */
export default async function MarketingLayout({ children, params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const { landing } = await getMessages();
  return (
    <html lang={locale} dir={dirOf(locale)} data-theme="dark" suppressHydrationWarning>
      <body>
        <NextIntlClientProvider messages={{ landing }}>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}

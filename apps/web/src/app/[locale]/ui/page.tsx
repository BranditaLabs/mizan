import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { cookies } from "next/headers";
import { LocaleSwitch } from "@/components/LocaleSwitch";
import { ThemeSwitch } from "@/components/ThemeSwitch";
import { ThemedWordmark } from "@/components/Wordmark";
import { parseTheme, THEME_COOKIE } from "@/lib/theme";
import { UiGallery } from "./UiGallery";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "gallery" });
  return { title: t("title"), robots: { index: false } };
}

/** The UI kit gallery (E4-3): sample data only, no sign-in needed. */
export default async function UiPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <div className="min-h-dvh bg-bg">
      <header className="mz-header">
        <ThemedWordmark />
        <span className="flex-1" />
        <LocaleSwitch />
        <span className="hidden sm:contents"><ThemeSwitch initial={theme} /></span>
      </header>
      <main id="main"><UiGallery /></main>
    </div>
  );
}

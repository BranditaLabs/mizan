import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { cookies } from "next/headers";
import { AuthSplit } from "@/components/AuthFrame";
import { Showcase } from "@/components/auth/Showcase";
import { RequireUser } from "@/components/auth/Gate";
import { Welcome } from "@/components/auth/Welcome";
import { parseTheme, THEME_COOKIE } from "@/lib/theme";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "welcome" });
  return { title: t("title"), robots: { index: false } };
}

export default async function Page({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <AuthSplit theme={theme} showcase={<Showcase />} compactShowcase={<Showcase compact />}>
      <RequireUser><Welcome /></RequireUser>
    </AuthSplit>
  );
}

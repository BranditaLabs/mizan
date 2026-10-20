import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { cookies } from "next/headers";
import { AuthFrame } from "@/components/AuthFrame";
import { RequireUser } from "@/components/auth/Gate";
import { TwoStep } from "@/components/auth/TwoStep";
import { parseTheme, THEME_COOKIE } from "@/lib/theme";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "twoStep" });
  return { title: t("title"), robots: { index: false } };
}

export default async function Page({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <AuthFrame theme={theme}>
      <RequireUser><TwoStep /></RequireUser>
    </AuthFrame>
  );
}

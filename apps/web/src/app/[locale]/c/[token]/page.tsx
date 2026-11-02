import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { cookies } from "next/headers";
import { AuthFrame } from "@/components/AuthFrame";
import { ConfirmPage } from "@/components/confirm/ConfirmPage";
import { parseTheme, THEME_COOKIE } from "@/lib/theme";

type Props = { params: Promise<{ locale: string; token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "confirm" });
  return { title: t("title"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

/** The customer's confirm link (M2, E6-7): no sign-in, the token in the path is the key. */
export default async function ConfirmRoute({ params }: Props) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return <AuthFrame theme={theme}><ConfirmPage token={token} /></AuthFrame>;
}

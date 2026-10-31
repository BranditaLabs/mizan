import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { cookies } from "next/headers";
import { AuthSplit } from "@/components/AuthFrame";
import { SignIn } from "@/components/auth/SignIn";
import { safeNext } from "@/lib/next-path";
import { parseTheme, THEME_COOKIE } from "@/lib/theme";

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth" });
  return { title: t("title"), robots: { index: false } };
}

export default async function SignInPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const q = await searchParams;
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <AuthSplit theme={theme}>
      <SignIn next={safeNext(q.next)} enrolled={q.enrolled === "1"} signup={q.mode === "signup"} />
    </AuthSplit>
  );
}

import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SignIn } from "@/components/auth/SignIn";
import { parseAuthParams } from "@/lib/auth/params";

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth" });
  return { title: t("title"), robots: { index: false } };
}

/** Every query value is allow-listed and mapped to an enum here, on the server (lib/auth/params.ts). */
export default async function SignInPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <SignIn params={parseAuthParams(await searchParams)} />;
}

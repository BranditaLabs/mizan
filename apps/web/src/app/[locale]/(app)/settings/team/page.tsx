import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { TeamScreen } from "@/components/settings/TeamScreen";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "team" });
  return { title: t("title") };
}

/** Settings → Team (A-8). */
export default async function TeamPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <TeamScreen />;
}

import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PrivacyScreen } from "@/components/settings/PrivacyScreen";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "privacySettings" });
  return { title: t("title") };
}

/** Settings → Privacy: the store's data requests (docs/07). */
export default async function PrivacySettingsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <PrivacyScreen />;
}

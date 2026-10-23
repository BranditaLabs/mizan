import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { OffersSettingsScreen } from "@/components/settings/OffersSettingsScreen";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "offersSettings" });
  return { title: t("title") };
}

/** Settings → Offers (M2, E6-11). */
export default async function OffersSettingsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <OffersSettingsScreen />;
}

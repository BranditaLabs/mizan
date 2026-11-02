import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ConversionSettingsScreen } from "@/components/settings/ConversionSettingsScreen";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "conversionSettings" });
  return { title: t("title") };
}

/** Settings → Payments: COD conversion (E14-3). */
export default async function Page({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ConversionSettingsScreen />;
}

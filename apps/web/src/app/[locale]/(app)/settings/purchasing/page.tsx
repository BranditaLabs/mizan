import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PurchasingSettingsScreen } from "@/components/settings/PurchasingSettingsScreen";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "purchasingSettings" });
  return { title: t("title") };
}

/** Settings → Purchasing (M16-2). */
export default async function Page({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <PurchasingSettingsScreen />;
}

import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { InventorySettingsScreen } from "@/components/settings/InventorySettingsScreen";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "settings.pages" });
  return { title: t("inventory") };
}

/** Settings → Inventory (U4): sending Mizan's count to the store, moved here from the stock screen. */
export default async function InventorySettingsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <InventorySettingsScreen />;
}

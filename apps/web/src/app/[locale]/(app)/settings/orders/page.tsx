import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { OrderSettingsScreen } from "@/components/settings/OrderSettingsScreen";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "orderSettings" });
  return { title: t("title") };
}

/** Settings → Orders (M1, E5-3). */
export default async function OrderSettingsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <OrderSettingsScreen />;
}

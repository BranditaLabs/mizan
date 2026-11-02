import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { RefundSettingsScreen } from "@/components/settings/RefundSettingsScreen";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "refundSettings" });
  return { title: t("title") };
}

/** Settings → Refunds (M15, E14-4). */
export default async function RefundSettingsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <RefundSettingsScreen />;
}

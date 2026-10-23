import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AdSpendScreen } from "@/components/settings/AdSpendScreen";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "adSpend" });
  return { title: t("title") };
}

/** Settings → Ad spend (M5, E9-3). */
export default async function AdSpendPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <AdSpendScreen />;
}

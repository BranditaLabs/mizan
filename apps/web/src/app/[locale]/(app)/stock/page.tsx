import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { StockScreen } from "@/components/stock/StockScreen";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "stock" });
  return { title: t("title") };
}

/** M4 stock (E8-2). */
export default async function StockPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <StockScreen />;
}

import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ProfitBreakdown } from "@/components/profit/ProfitBreakdown";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "profitBreakdown" });
  return { title: t("title") };
}

/** M5 profit breakdown (E9-5). */
export default async function ProfitPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ProfitBreakdown />;
}

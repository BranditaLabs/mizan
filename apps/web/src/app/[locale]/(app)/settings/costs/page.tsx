import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CostsScreen } from "@/components/settings/CostsScreen";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "costs" });
  return { title: t("title") };
}

/** Settings → Costs (M5, E9-1). */
export default async function CostsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <CostsScreen />;
}

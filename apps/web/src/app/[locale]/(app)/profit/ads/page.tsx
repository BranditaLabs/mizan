import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AdsRoas } from "@/components/profit/AdsRoas";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "adsRoas" });
  return { title: t("title") };
}

/** M7 true ROAS (M7-1). */
export default async function Page({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <AdsRoas />;
}

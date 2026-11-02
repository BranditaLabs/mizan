import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { UsageScreen } from "@/components/settings/UsageScreen";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "usage" });
  return { title: t("title") };
}

/** Settings → Plan and usage (billing, E12-3). */
export default async function UsagePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <UsageScreen />;
}

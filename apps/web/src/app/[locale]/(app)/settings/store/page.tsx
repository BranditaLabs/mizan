import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { StoreProfileScreen } from "@/components/settings/StoreProfileScreen";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "storeProfile" });
  return { title: t("title") };
}

/** Settings → Store (A-8). */
export default async function StorePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <StoreProfileScreen />;
}

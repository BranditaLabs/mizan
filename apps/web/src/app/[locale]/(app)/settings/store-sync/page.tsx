import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { StoreSyncScreen } from "@/components/settings/StoreSyncScreen";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "storeSync" });
  return { title: t("title") };
}

/** Settings → Store sync (E7-7). */
export default async function StoreSyncPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <StoreSyncScreen />;
}

import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AfterConfirmationScreen } from "@/components/settings/AfterConfirmationScreen";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "afterConfirmation" });
  return { title: t("title") };
}

/** Settings → After confirmation (M2, E6-23). */
export default async function AfterConfirmationPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <AfterConfirmationScreen />;
}

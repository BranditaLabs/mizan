import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ConfirmationSettingsScreen } from "@/components/settings/ConfirmationSettingsScreen";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "confirmationSettings" });
  return { title: t("title") };
}

/** Settings → Confirmation (M2, E6-7). */
export default async function ConfirmationSettingsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ConfirmationSettingsScreen />;
}

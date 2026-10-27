import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { IntegrationsScreen } from "@/components/settings/IntegrationsScreen";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "integrationsSettings" });
  return { title: t("title") };
}

/** Settings → Integrations (A-8). */
export default async function IntegrationsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <IntegrationsScreen />;
}

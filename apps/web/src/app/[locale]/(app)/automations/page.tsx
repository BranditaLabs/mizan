import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Automations } from "@/components/automations/Automations";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "automations" });
  return { title: t("title") };
}

/** M13 Automation Studio: recipes, switches, run log (E11-2). */
export default async function AutomationsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <Automations />;
}

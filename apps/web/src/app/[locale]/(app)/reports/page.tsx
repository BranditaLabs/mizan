import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ReportsScreen } from "@/components/reports/ReportsScreen";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "reports" });
  return { title: t("title") };
}

/** Reports (M20, E15-2): the built-in dashboards and their exports. */
export default async function ReportsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ReportsScreen />;
}

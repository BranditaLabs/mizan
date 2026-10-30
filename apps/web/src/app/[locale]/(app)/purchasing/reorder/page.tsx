import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ReorderScreen } from "@/components/purchasing/ReorderScreen";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "purchasing" });
  return { title: t("reorder.title") };
}

/** Reorder suggestions (M16-4b). */
export default async function Page({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ReorderScreen />;
}

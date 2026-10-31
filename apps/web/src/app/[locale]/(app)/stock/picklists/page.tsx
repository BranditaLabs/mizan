import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PickLists } from "@/components/stock/PickLists";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pickLists" });
  return { title: t("title") };
}

/** M4 pick lists (E8-4c). */
export default async function PickListsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <PickLists />;
}

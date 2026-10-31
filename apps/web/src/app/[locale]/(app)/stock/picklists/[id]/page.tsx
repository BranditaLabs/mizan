import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PickListDetail } from "@/components/stock/PickLists";

type Props = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pickLists" });
  return { title: t("title") };
}

/** One pick list, to print and close (E8-4c). */
export default async function PickListPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return <PickListDetail id={id} />;
}

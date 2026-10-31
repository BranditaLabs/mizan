import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PurchaseOrdersScreen } from "@/components/purchasing/PurchaseOrdersScreen";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "purchasing" });
  return { title: t("title") };
}

/** M16 purchase orders (M16-2). */
export default async function Page({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <PurchaseOrdersScreen />;
}

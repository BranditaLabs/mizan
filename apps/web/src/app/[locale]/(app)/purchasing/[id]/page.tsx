import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PurchaseOrderDetail } from "@/components/purchasing/PurchaseOrderDetail";

type Props = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "purchasing" });
  return { title: t("title") };
}

/** One purchase order (M16-2). */
export default async function Page({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return <PurchaseOrderDetail id={id} />;
}

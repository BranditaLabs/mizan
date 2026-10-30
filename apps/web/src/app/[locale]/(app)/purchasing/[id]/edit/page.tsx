import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { EditPurchaseOrder } from "@/components/purchasing/EditPurchaseOrder";

type Props = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "purchasing" });
  return { title: t("title") };
}

/** Edit a draft purchase order (M16-4a). */
export default async function Page({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return <EditPurchaseOrder id={id} />;
}

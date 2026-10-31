import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { NewOrder } from "@/components/orders/NewOrder";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "newOrder" });
  return { title: t("title") };
}

/** M1 manual order (E5-5). */
export default async function NewOrderPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <NewOrder />;
}

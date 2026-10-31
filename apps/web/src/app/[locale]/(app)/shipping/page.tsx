import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ShipmentsScreen } from "@/components/shipping/ShipmentsScreen";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "shipments" });
  return { title: t("title") };
}

/** Shipping (M3, E7-3): shipments with the courier and the review queue. */
export default async function ShippingPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ShipmentsScreen />;
}

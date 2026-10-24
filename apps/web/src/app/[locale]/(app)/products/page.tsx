import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Products } from "@/components/catalog/Products";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "products" });
  return { title: t("title") };
}

/** M4 products: costs, barcodes, CSV import (E8-1). */
export default async function ProductsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <Products />;
}

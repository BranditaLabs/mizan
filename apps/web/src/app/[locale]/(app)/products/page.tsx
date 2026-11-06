import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Products } from "@/components/catalog/Products";

type Props = { params: Promise<{ locale: string }>; searchParams?: Promise<{ view?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "products" });
  return { title: t("title") };
}

/** M4 products: costs, barcodes, CSV import (E8-1). `?view=missing_cost` opens on the products without a cost (FX-2 links). */
export default async function ProductsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const view = (await searchParams)?.view;
  return <Products initialFilter={view === "missing_cost" ? "cost" : view === "missing_barcode" ? "barcode" : "all"} />;
}

import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { NewProduct } from "@/components/catalog/NewProduct";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "products.newProduct" });
  return { title: t("title") };
}

/** P3: a product made in Mizan. */
export default async function NewProductPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <NewProduct />;
}

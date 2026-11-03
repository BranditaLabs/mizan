import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { StoreGate } from "@/components/auth/Gate";
import { PrintDocuments } from "@/components/orders/PrintDocuments";

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "orders.print" });
  return { title: t("pageTitle"), robots: { index: false } };
}

/**
 * O4: invoices or packing slips, `?kind=invoice|packing_slip&ids=<id>,<id>` (100 at most), one page
 * each, laid out for print in the page's language; the browser prints them or saves them as PDF.
 * Signed in and in a store, without the app frame.
 */
export default async function PrintOrdersPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const q = await searchParams;
  const ids = [...new Set(one(q.ids).split(",").map((s) => s.trim()).filter((s) => UUID.test(s)))].slice(0, 100);
  const kind = one(q.kind) === "packing_slip" ? "packing_slip" : "invoice";
  return <StoreGate><PrintDocuments ids={ids} kind={kind} /></StoreGate>;
}

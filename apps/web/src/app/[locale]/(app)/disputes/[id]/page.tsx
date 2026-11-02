import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { EvidencePack } from "@/components/payments/Disputes";

type Props = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "disputes" });
  return { title: t("pack") };
}

/** A chargeback's evidence pack, to print or save as PDF for the gateway (E14-5). */
export default async function Page({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return <EvidencePack disputeId={id} />;
}

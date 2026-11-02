import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PaymentsScreen } from "@/components/payments/PaymentsScreen";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "paymentsScreen" });
  return { title: t("title") };
}

/** M15 payments (E14-6). */
export default async function PaymentsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <PaymentsScreen />;
}

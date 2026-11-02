import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CallQueue } from "@/components/confirmation/CallQueue";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "callQueue" });
  return { title: t("title") };
}

/** M2 the team's call queue (E6-3). */
export default async function ConfirmationPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <CallQueue />;
}

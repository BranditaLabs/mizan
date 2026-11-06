import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { phoneChrome } from "@/components/studio/chrome";
import { ConfirmationStudio } from "@/components/studio/ConfirmationStudio";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "confirmationStudio" });
  return { title: t("title") };
}

/** Settings → Confirmation → Studio (M2, E6-16b). */
export default async function ConfirmationStudioPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ConfirmationStudio chrome={await phoneChrome()} />;
}

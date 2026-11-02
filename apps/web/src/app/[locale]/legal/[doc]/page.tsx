import { readFile } from "node:fs/promises";
import path from "node:path";
import { LEGAL_DOCUMENTS } from "@mizan/shared";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { LegalPage } from "@/components/legal/LegalPage";
import { routing, type Locale } from "@/i18n/routing";
import { isLegalDocument, LEGAL_FILES } from "@/lib/legal";
import { parseTheme, THEME_COOKIE } from "@/lib/theme";

type Props = { params: Promise<{ locale: string; doc: string }> };

/** Every language × document is known at build time; anything else is a 404. */
export const dynamicParams = false;
export function generateStaticParams() {
  return routing.locales.flatMap((locale) => LEGAL_DOCUMENTS.map((doc) => ({ locale, doc })));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, doc } = await params;
  if (!isLegalDocument(doc)) return {};
  const t = await getTranslations({ locale, namespace: "legal" });
  return { title: t(`docs.${doc}`), description: t("description") };
}

/** Terms of service, privacy policy and DPA (L1-3): public, no sign-in. The text is content/legal (a copy of docs/legal). */
export default async function LegalRoute({ params }: Props) {
  const { locale, doc } = await params;
  if (!isLegalDocument(doc)) notFound();
  setRequestLocale(locale);
  // next.config.ts traces content/legal into the standalone image (outputFileTracingIncludes).
  const source = await readFile(path.join(process.cwd(), "content", "legal", `${LEGAL_FILES[doc]}.${locale as Locale}.md`), "utf8");
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return <LegalPage doc={doc} source={source} theme={theme} />;
}

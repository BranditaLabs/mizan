import { LEGAL_DOCUMENTS, LEGAL_STATUS, LEGAL_VERSIONS, type LegalDocument } from "@mizan/shared";
import { useLocale, useTranslations } from "next-intl";
import { Bdi } from "@/components/Bdi";
import { LocaleSwitch } from "@/components/LocaleSwitch";
import { ThemeSwitch } from "@/components/ThemeSwitch";
import { ThemedWordmark } from "@/components/Wordmark";
import { Alert } from "@/components/ui/Alert";
import { Link } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { legalPath } from "@/lib/legal";
import type { Theme } from "@/lib/theme";
import { LegalMarkdown } from "./LegalMarkdown";

/**
 * A legal document as a public page (L1-3): no sign-in, a readable measure, the draft banner while
 * LEGAL_STATUS is "draft", and a footer to the other documents and the other language.
 */
export function LegalPage({ doc, source, theme }: { doc: LegalDocument; source: string; theme: Theme }) {
  const t = useTranslations("legal");
  const locale = useLocale() as Locale;
  const other = routing.locales.find((l) => l !== locale)!;
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-text">
      <header className="flex h-14 items-center gap-3 border-b border-line px-4 md:px-6">
        <Link href="/" aria-label={t("home")}><ThemedWordmark /></Link>
        <span className="flex-1" />
        <span className="hidden sm:contents"><LocaleSwitch /></span>
        <ThemeSwitch initial={theme} />
      </header>
      <main id="main" className="flex-1 px-4 pt-6 pb-14 sm:pt-10">
        <article className="mx-auto w-full max-w-[72ch]" data-testid={`legal-${doc}`}>
          {LEGAL_STATUS === "draft" ? <div className="mb-6"><Alert tone="warning" title={t("draft.title")}>{t("draft.body")}</Alert></div> : null}
          <p className="mb-2 text-caption text-text-3">{t.rich("version", { version: LEGAL_VERSIONS[doc], n: (c) => <Bdi>{c}</Bdi> })}</p>
          <LegalMarkdown source={source} />
        </article>
      </main>
      <footer className="border-t border-line px-4 py-6 md:px-6">
        <nav aria-label={t("nav")} className="mx-auto flex w-full max-w-[72ch] flex-wrap items-center gap-x-5 gap-y-2 text-body-sm">
          {LEGAL_DOCUMENTS.map((d) => (
            <Link key={d} href={legalPath(d)} aria-current={d === doc ? "page" : undefined}
              className={d === doc ? "font-medium text-text" : "text-text-2 underline underline-offset-2"}>{t(`docs.${d}`)}</Link>
          ))}
          <span className="flex-1" />
          <Link href={legalPath(doc)} locale={other} hrefLang={other} className="text-text-2 underline underline-offset-2">{t("otherLanguage")}</Link>
        </nav>
      </footer>
    </div>
  );
}

import type { LegalDocument } from "@mizan/shared";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { legalPath } from "@/lib/legal";

/** A legal page opened in a new tab (a form being filled stays where it is); says so to screen readers. */
export function LegalLink({ doc, children }: { doc: LegalDocument; children: ReactNode }) {
  const t = useTranslations("legal");
  return (
    <Link href={legalPath(doc)} target="_blank" rel="noopener" className="underline underline-offset-2">
      {children}<span className="sr-only"> {t("newTab")}</span>
    </Link>
  );
}

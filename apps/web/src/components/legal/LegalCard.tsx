"use client";

import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Bdi } from "@/components/Bdi";
import { Card, SkeletonRows } from "@/components/ui/Surface";
import { Link } from "@/i18n/navigation";
import { legalPath } from "@/lib/legal";
import { useStoreLegal } from "./LegalGate";

/** Settings → Store, "Legal" (L1-3): what the store accepted, which version, when and who; links to the pages. */
export function LegalCard() {
  const t = useTranslations("legal");
  const format = useFormatter();
  const q = useStoreLegal();
  const n = (c: ReactNode) => <Bdi>{c}</Bdi>;
  return (
    <Card title={t("card.title")} className="md:col-span-3" bodyClassName="flex flex-col gap-3">
      <p className="text-body-sm text-text-2">{t("card.subtitle")}</p>
      {!q.data ? (q.isError ? null : <SkeletonRows rows={2} label={t("card.loading")} />) : (
        <>
          {q.data.status === "draft" ? <p className="text-caption text-text-3">{t("card.draft")}</p> : null}
          <ul className="flex flex-col divide-y divide-line" data-testid="legal-card">
            {q.data.documents.map((d) => {
              const date = d.acceptedAt ? format.dateTime(new Date(d.acceptedAt), { dateStyle: "medium" }) : "";
              return (
                <li key={d.document} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
                  <Link href={legalPath(d.document)} className="text-label underline underline-offset-2">{t(`docs.${d.document}`)}</Link>
                  <span className="text-body-sm text-text-2">
                    {!d.acceptedAt ? t("card.notAccepted")
                      : d.acceptedBy?.name ? t.rich("card.acceptedBy", { version: d.version, date, name: d.acceptedBy.name, n })
                      : t.rich("card.accepted", { version: d.version, date, n })}
                  </span>
                </li>
              );
            })}
            <li className="py-2.5">
              <Link href={legalPath("privacy")} className="text-label underline underline-offset-2">{t("card.privacy")}</Link>
            </li>
          </ul>
        </>
      )}
    </Card>
  );
}

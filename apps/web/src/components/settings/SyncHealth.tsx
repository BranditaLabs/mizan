"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Bdi } from "@/components/Bdi";
import { Badge } from "@/components/ui/Badge";
import { Pending } from "@/components/ui/QueryState";
import { SkeletonRows } from "@/components/ui/Surface";
import { DateText } from "@/components/ui/Values";
import { ok } from "@/lib/api/client";
import { useSession } from "@/lib/session";

/** A round is due every 5 minutes: longer than this without one means the guardian is not running. */
const LATE_MS = 20 * 60_000;

/**
 * The sync guardian at a glance (Shopify ⇄ Mizan ⇄ courier): when it last checked each store for
 * what webhooks dropped, what it fixed on its own in the last day, the failed jobs it will try again
 * by itself, and those waiting for a person (listed below, with Replay).
 */
export function SyncHealth() {
  const t = useTranslations("integrationsSettings.sync");
  const { api, user, store } = useSession();
  const q = useQuery({
    queryKey: ["syncHealth", user?.uid ?? "", store?.tenantId ?? ""],
    queryFn: () => ok(api.GET("/v1/admin/integrations/sync")),
    refetchInterval: 60_000,
  });
  const h = q.data;
  const late = !h?.checkedAt || q.dataUpdatedAt - Date.parse(h.checkedAt) > LATE_MS; // measured when the answer came
  const fixed = h ? h.recovered.rebooked + h.recovered.reasserted + h.recovered.revived : 0;
  const tone = !h ? "neutral" : h.needsYou ? "danger" : late ? "warning" : h.retrying.count ? "warning" : "success";
  const state = !h ? "" : h.needsYou ? t("state.needsYou", { n: h.needsYou }) : late ? t("state.late") : h.retrying.count ? t("state.retrying") : t("state.ok");

  return (
    <section className="mz-card p-5" data-testid="sync-health">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-heading-sm">{t("title")}</h2>
          <p className="text-body-sm text-text-2">{t("subtitle")}</p>
        </div>
        {h ? <Badge tone={tone}>{state}</Badge> : null}
      </div>
      {!h ? <Pending query={q} compact><SkeletonRows rows={2} label={t("loading")} /></Pending> : (
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-body-sm sm:grid-cols-2">
          <div className="flex justify-between gap-3">
            <dt className="text-text-2">{t("checked")}</dt>
            <dd>{h.checkedAt ? <DateText value={h.checkedAt} relative /> : t("never")}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-text-2">{t("fixed")}</dt>
            <dd><Bdi>{fixed}</Bdi></dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-text-2">{t("retrying")}</dt>
            <dd>
              <Bdi>{h.retrying.count}</Bdi>
              {h.retrying.nextAt ? <span className="ms-1 text-caption text-text-2">{t("next")} <DateText value={h.retrying.nextAt} relative /></span> : null}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-text-2">{t("needsYou")}</dt>
            <dd><Badge tone={h.needsYou ? "danger" : "success"}><Bdi>{h.needsYou}</Bdi></Badge></dd>
          </div>
          {h.stores.length > 1 ? h.stores.map((s) => (
            <div key={s.connectionId} className="flex justify-between gap-3 sm:col-span-2">
              <dt className="text-text-2"><Bdi>{s.name ?? s.provider}</Bdi></dt>
              <dd>{s.checkedAt ? <DateText value={s.checkedAt} relative /> : t("never")}</dd>
            </div>
          )) : null}
        </dl>
      )}
      <p className="mt-3 text-caption text-text-3">{t("how")}</p>
    </section>
  );
}

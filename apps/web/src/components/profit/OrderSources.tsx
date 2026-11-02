"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Card, EmptyState, SkeletonRows } from "@/components/ui/Surface";
import { MoneyText } from "@/components/ui/Values";
import { ok, type Schemas } from "@/lib/api/client";
import { useSession } from "@/lib/session";
import { PlatformName } from "./PlatformName";

type Sources = Schemas["OrderSources"];
type PlatformRow = Sources["byPlatform"][number];
type CampaignRow = Sources["campaigns"][number];

/**
 * Where the period's orders came from (M7-2): each source platform with its orders, how many were
 * delivered, the money that arrived and the profit, and true ROAS where spend is recorded; then
 * the UTM campaigns. Orders with no source are shown as unknown, never hidden. Owners and admins
 * can read the stores' recent orders again to fill in older ones.
 */
export function OrderSources({ days }: { days: number }) {
  const t = useTranslations("sources");
  const { api, user, store } = useSession();
  const q = useQuery({
    queryKey: ["order-sources", user?.uid ?? "", store?.tenantId ?? "", days],
    queryFn: () => ok(api.GET("/v1/attribution/sources", { params: { query: { days } } })),
    enabled: Boolean(store),
  });
  const backfill = useMutation({ mutationFn: () => ok(api.POST("/v1/attribution/sources/backfill")) });
  const canBackfill = store?.role === "owner" || store?.role === "admin";

  const x = (v: string | null) => (v === null ? t("none") : t.rich("times", { v, n: (c) => <bdi className="mz-num">{c}</bdi> }));
  const rate = (v: string | null) => (v === null ? t("none") : t("pct", { pct: v }));
  const platforms: ReadonlyArray<Column<PlatformRow>> = [
    { id: "platform", header: t("col.platform"), cell: (r) => <span className="flex items-center gap-2"><PlatformName platform={r.platform} />{r.paid ? <span className="text-caption text-text-3">{t("paidOf", { n: r.paid })}</span> : null}</span> },
    { id: "orders", header: t("col.orders"), numeric: true, sortValue: (r) => r.orders, cell: (r) => <bdi>{r.orders}</bdi> },
    { id: "share", header: t("col.share"), numeric: true, cell: (r) => rate(r.share) },
    { id: "delivered", header: t("col.delivered"), numeric: true, sortValue: (r) => r.delivered, cell: (r) => <bdi>{r.delivered}</bdi> },
    { id: "rate", header: t("col.rate"), numeric: true, cell: (r) => rate(r.deliveredRate) },
    { id: "real", header: t("col.real"), numeric: true, sortValue: (r) => Number(r.real.amount), cell: (r) => <MoneyText money={r.real} /> },
    { id: "net", header: t("col.net"), numeric: true, sortValue: (r) => Number(r.net.amount), cell: (r) => <MoneyText money={r.net} /> },
    { id: "roas", header: t("col.roas"), numeric: true, cell: (r) => x(r.trueRoas) },
  ];
  const campaigns: ReadonlyArray<Column<CampaignRow>> = [
    { id: "campaign", header: t("col.campaign"), cell: (r) => <span className="flex flex-col"><bdi className="font-medium">{r.campaign}</bdi><span className="text-caption text-text-3"><PlatformName platform={r.platform} /></span></span> },
    { id: "orders", header: t("col.orders"), numeric: true, sortValue: (r) => r.orders, cell: (r) => <bdi>{r.orders}</bdi> },
    { id: "delivered", header: t("col.delivered"), numeric: true, sortValue: (r) => r.delivered, cell: (r) => <bdi>{r.delivered}</bdi> },
    { id: "rate", header: t("col.rate"), numeric: true, cell: (r) => rate(r.deliveredRate) },
    { id: "real", header: t("col.real"), numeric: true, sortValue: (r) => Number(r.real.amount), cell: (r) => <MoneyText money={r.real} /> },
    { id: "net", header: t("col.net"), numeric: true, sortValue: (r) => Number(r.net.amount), cell: (r) => <MoneyText money={r.net} /> },
  ];

  const s = q.data;
  return (
    <section className="flex flex-col gap-4" aria-labelledby="sources-title" data-testid="order-sources">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="sources-title" className="font-display text-heading-md">{t("title")}</h2>
          <p className="mt-1 max-w-[70ch] text-body-sm text-text-2">
            {s && s.attributedShare !== null ? t.rich("known", { pct: s.attributedShare, orders: s.orders, b: (c) => <strong><bdi className="mz-num">{c}</bdi></strong> }) : t("subtitle")}
          </p>
        </div>
        {canBackfill ? <Button variant="secondary" size="sm" icon="refresh" busy={backfill.isPending} disabled={backfill.isSuccess} onClick={() => backfill.mutate()}>{t("backfill")}</Button> : null}
      </header>
      {backfill.isSuccess ? <Alert tone="success">{t("backfillStarted", { days: backfill.data.days })}</Alert> : null}
      {backfill.isError ? <Alert tone="danger">{t("backfillFailed")}</Alert> : null}
      {q.isPending ? <div className="mz-card"><SkeletonRows rows={4} label={t("loading")} /></div> : null}
      {q.isError ? <Alert tone="danger">{t("loadFailed")}</Alert> : null}
      {s && s.orders === 0 ? <div className="mz-card"><EmptyState icon="orders" title={t("empty.title")} body={t("empty.body")} /></div> : null}
      {s && s.orders > 0 ? (
        <>
          <Card title={t("platformsTitle")} bodyClassName="p-0">
            <DataTable label={t("platformsTitle")} columns={platforms} rows={s.byPlatform} rowKey={(r) => r.platform} defaultSort={{ id: "orders", dir: "desc" }} />
          </Card>
          <Card title={t("campaignsTitle")} bodyClassName="p-0">
            <DataTable label={t("campaignsTitle")} columns={campaigns} rows={s.campaigns} rowKey={(r) => `${r.platform}:${r.campaign}`} defaultSort={{ id: "orders", dir: "desc" }}
              empty={<EmptyState icon="profit" title={t("noCampaigns.title")} body={t("noCampaigns.body")} />} />
          </Card>
        </>
      ) : null}
    </section>
  );
}

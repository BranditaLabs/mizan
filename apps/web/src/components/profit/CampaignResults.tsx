"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Segmented } from "@/components/ui/Choice";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Card, EmptyState, SkeletonRows } from "@/components/ui/Surface";
import { MoneyText } from "@/components/ui/Values";
import { ok, type Schemas } from "@/lib/api/client";
import { useSession } from "@/lib/session";
import { latin } from "@/lib/rich";
import { PlatformName, type SourcePlatform } from "./PlatformName";

type Results = Schemas["CampaignResults"];
type Row = Results["rows"][number];
type Level = Results["level"];
const LEVELS: readonly Level[] = ["campaign", "adset", "ad"];

/**
 * Campaign results (M7-3): per campaign, ad set or ad, what it spent against what its orders really
 * brought: orders, delivered rate, the share that never paid (cancelled, refused, returned), cost
 * per delivered order, the money that arrived, true ROAS and net profit. Tagged orders without spend
 * keep their own rows; untagged orders and spend without the level are shown under the table.
 */
export function CampaignResults({ days }: { days: number }) {
  const t = useTranslations("campaigns");
  const ts = useTranslations("adSpend.platform");
  const { api, user, store } = useSession();
  const [level, setLevel] = useState<Level>("campaign");
  const q = useQuery({
    queryKey: ["campaign-results", user?.uid ?? "", store?.tenantId ?? "", days, level],
    queryFn: () => ok(api.GET("/v1/attribution/campaigns", { params: { query: { days, level } } })),
    enabled: Boolean(store),
  });

  const none = t("none");
  const x = (v: string | null) => (v === null ? none : t.rich("times", { v, n: (c) => <bdi className="mz-num">{c}</bdi> }));
  const pct = (v: string | null) => (v === null ? none : t("pct", { pct: v }));
  const platform = (p: Row["platform"]) => (p === "other" ? <span>{ts("other")}</span> : <PlatformName platform={p as SourcePlatform} />);
  const name = (r: Row) => (level === "ad" ? r.ad : level === "adset" ? r.adset : r.campaign)!.name;
  const columns: ReadonlyArray<Column<Row>> = [
    {
      id: "name", header: t(`col.${level}`), cell: (r) => (
        <span className="flex min-w-0 flex-col">
          <bdi className="truncate font-medium">{name(r)}</bdi>
          <span className="truncate text-caption text-text-3">
            {platform(r.platform)}
            {level !== "campaign" ? <>{" · "}<bdi>{r.campaign.name}</bdi></> : null}
            {level === "ad" && r.adset ? <>{" · "}<bdi>{r.adset.name}</bdi></> : null}
          </span>
        </span>
      ),
    },
    { id: "spend", header: t("col.spend"), numeric: true, sortValue: (r) => (r.spend ? Number(r.spend.amount) : -1), cell: (r) => (r.spend ? <MoneyText money={r.spend} /> : <span className="text-text-3">{t("noSpend")}</span>) },
    { id: "orders", header: t("col.orders"), numeric: true, sortValue: (r) => r.orders, cell: (r) => <bdi>{r.orders}</bdi> },
    { id: "rate", header: t("col.rate"), numeric: true, sortValue: (r) => Number(r.deliveredRate ?? -1), cell: (r) => pct(r.deliveredRate) },
    { id: "fake", header: t("col.fake"), numeric: true, sortValue: (r) => Number(r.fakeShare ?? -1), cell: (r) => pct(r.fakeShare) },
    { id: "cpd", header: t("col.costPerDelivered"), numeric: true, sortValue: (r) => (r.costPerDelivered ? Number(r.costPerDelivered.amount) : Infinity), cell: (r) => (r.costPerDelivered ? <MoneyText money={r.costPerDelivered} /> : none) },
    { id: "real", header: t("col.real"), numeric: true, sortValue: (r) => Number(r.real.amount), cell: (r) => <MoneyText money={r.real} /> },
    { id: "roas", header: t("col.roas"), numeric: true, sortValue: (r) => Number(r.trueRoas ?? -1), cell: (r) => x(r.trueRoas) },
    { id: "net", header: t("col.net"), numeric: true, sortValue: (r) => Number(r.net.amount), cell: (r) => <MoneyText money={r.net} /> },
  ];

  const r = q.data;
  const rowKey = (row: Row) => [row.platform, row.campaign.key, row.adset?.key ?? "", row.ad?.key ?? "", row.spend ? "s" : "o"].join("|");
  return (
    <section className="flex flex-col gap-4" aria-labelledby="campaigns-title" data-testid="campaign-results">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="campaigns-title" className="font-display text-heading-md">{t("title")}</h2>
          <p className="mt-1 max-w-[70ch] text-body-sm text-text-2">{t("subtitle")}</p>
        </div>
        <Segmented label={t("levelLabel")} value={level} onChange={setLevel} options={LEVELS.map((l) => ({ value: l, label: t(`level.${l}`) }))} />
      </header>
      {r?.fxMissing ? <Alert tone="warning">{t("fxMissing")}</Alert> : null}
      {q.isPending ? <div className="mz-card"><SkeletonRows rows={4} label={t("loading")} /></div> : null}
      {q.isError ? <Alert tone="danger">{t("loadFailed")}</Alert> : null}
      {r ? (
        <Card title={t(`tableTitle.${level}`)} bodyClassName="p-0">
          <DataTable label={t(`tableTitle.${level}`)} columns={columns} rows={r.rows} rowKey={rowKey} defaultSort={{ id: "spend", dir: "desc" }}
            empty={<EmptyState icon="profit" title={t("empty.title")} body={t.rich(`empty.${level}`, latin)} />} />
          <dl className="grid gap-x-6 gap-y-1 border-t border-line px-4 py-3 text-body-sm text-text-2 sm:grid-cols-2">
            <div className="flex justify-between gap-3">
              <dt>{t(`untagged.${level}`)}</dt>
              <dd className="m-0 text-text">{t.rich("untaggedValue", { orders: r.untagged.orders, b: (c) => <bdi className="mz-num">{c}</bdi> })} · <MoneyText money={r.untagged.real} /></dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>{t(`unassigned.${level}`)}</dt>
              <dd className="m-0 text-text"><MoneyText money={r.unassignedSpend} /></dd>
            </div>
          </dl>
          {r.truncated ? <p className="border-t border-line px-4 py-2 text-caption text-text-3">{t("truncated")}</p> : null}
        </Card>
      ) : null}
    </section>
  );
}

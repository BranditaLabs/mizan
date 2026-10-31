"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Bdi } from "@/components/Bdi";
import { Cell, DataTable, type Column } from "@/components/ui/DataTable";
import { Card, EmptyState, SkeletonRows } from "@/components/ui/Surface";
import { ok, type Schemas } from "@/lib/api/client";
import { useSession } from "@/lib/session";

type Courier = Schemas["CourierScorecard"]["couriers"][number];
type Zone = Courier["zones"][number];
const PERIODS = [30, 90, 180] as const;
const READERS = new Set(["owner", "admin", "ops_manager", "finance"]);
const providerName = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Couriers by zone (M3, E7-4): which courier delivers where — delivered rate (the metric layer's
 * formula), returns, still out and days to deliver — so the owner picks the courier per zone.
 */
export function Scorecard() {
  const t = useTranslations("shipments.scorecard");
  const { api, user, store } = useSession();
  const [days, setDays] = useState<(typeof PERIODS)[number]>(90);
  const allowed = READERS.has(store?.role ?? "");
  const q = useQuery({
    queryKey: ["scorecard", user?.uid ?? "", store?.tenantId ?? "", days],
    queryFn: () => ok(api.GET("/v1/couriers/scorecard", { params: { query: { days } } })),
    enabled: Boolean(store) && allowed,
    placeholderData: (prev) => prev,
  });
  if (!allowed) return null;
  const pct = (v: string | null) => (v === null ? "—" : t("pct", { v }));
  const columns: Column<Zone>[] = [
    { id: "zone", header: t("zone"), cell: (z) => <span dir="auto">{z.zone ?? t("unknownZone")}</span> },
    { id: "shipments", header: t("shipments"), numeric: true, cell: (z) => <Bdi>{z.shipments}</Bdi> },
    { id: "delivered", header: t("deliveredRate"), numeric: true, cell: (z) => <Cell main={<Bdi>{pct(z.deliveredRate)}</Bdi>} sub={t("counts", { delivered: z.delivered, returned: z.returned })} /> },
    { id: "out", header: t("inFlight"), numeric: true, cell: (z) => <Bdi>{z.inFlight}</Bdi> },
    { id: "days", header: t("days"), numeric: true, cell: (z) => <Bdi>{z.avgDaysToDeliver ?? "—"}</Bdi> },
  ];
  return (
    <Card title={t("title")} actions={(
      <nav aria-label={t("period")} className="mz-tabs">
        {PERIODS.map((d) => <button key={d} type="button" className="mz-tab" aria-current={days === d ? "true" : undefined} onClick={() => setDays(d)}>{t("lastDays", { days: d })}</button>)}
      </nav>
    )}>
      <div className="flex flex-col gap-5" data-testid="scorecard">
        <p className="text-body-sm text-text-2">{t("hint")}</p>
        {q.isPending ? <SkeletonRows rows={3} label={t("title")} /> : !q.data?.couriers.length ? <EmptyState icon="shipping" title={t("empty.title")} body={t("empty.body")} /> : (
          q.data.couriers.map((c) => (
            <section key={c.courier} className="flex flex-col gap-2" aria-label={providerName(c.courier)}>
              <h3 className="text-heading-sm">
                {providerName(c.courier)}{" · "}
                <span className="text-body-sm font-normal text-text-2">{t("summary", { shipments: c.shipments, rate: pct(c.deliveredRate), rto: pct(c.rtoRate) })}</span>
              </h3>
              <DataTable label={providerName(c.courier)} columns={columns} rows={c.zones} rowKey={(z) => z.zone ?? "—"} />
            </section>
          ))
        )}
      </div>
    </Card>
  );
}

"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/Badge";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { EmptyState, SkeletonRows } from "@/components/ui/Surface";
import { ok, type Schemas } from "@/lib/api/client";
import { useSession } from "@/lib/session";
import { SettingsTabs } from "./SettingsTabs";

type Usage = Schemas["Usage"];
type Row = Usage["history"][number];
const READERS = new Set(["owner", "admin", "finance"]);

/** One meter: used against the plan's limit (none: just the count). Amber from 80%, red past it. */
function Meter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const t = useTranslations("usage");
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const tone = limit && used > limit ? "bg-danger" : limit && used >= limit * 0.8 ? "bg-warning" : "bg-text-3";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-body-sm">
        <span className="text-text-2">{label}</span>
        <span>{t.rich(limit === null ? "unlimited" : "ofLimit", { used, limit: limit ?? 0, n: (c) => <bdi dir="ltr" className="mz-num font-medium">{c}</bdi> })}</span>
      </div>
      {limit !== null ? (
        <span className="h-2 rounded-full bg-surface-sunk" aria-hidden="true"><span className={`block h-2 rounded-full ${tone}`} style={{ inlineSize: `${pct}%` }} /></span>
      ) : null}
      {limit !== null && used > limit ? <span className="text-caption text-danger-text">{t("over")}</span> : null}
    </div>
  );
}

/**
 * Settings → Plan and usage (E12-3): this month's orders, stores and users against the plan's
 * limits, messages and AI offers passed on at cost, and the last six months. Owner, admin, finance.
 */
export function UsageScreen() {
  const t = useTranslations("usage");
  const { api, user, store } = useSession();
  const allowed = READERS.has(store?.role ?? "");
  const q = useQuery({
    queryKey: ["usage", user?.uid ?? "", store?.tenantId ?? ""],
    queryFn: () => ok(api.GET("/v1/usage")),
    enabled: allowed,
  });
  const u = q.data;
  const columns: Column<Row>[] = [
    { id: "month", header: t("columns.month"), cell: (r) => <span className="inline-flex items-center gap-2"><bdi className="mz-num">{r.month}</bdi>{r.closed ? <Badge tone="neutral" dot={false}>{t("closed")}</Badge> : null}</span> },
    { id: "orders", header: t("columns.orders"), numeric: true, cell: (r) => <bdi className="mz-num">{r.orders}</bdi> },
    { id: "messages", header: t("columns.messages"), numeric: true, cell: (r) => <bdi className="mz-num">{r.whatsappMessages}</bdi> },
    { id: "ai", header: t("columns.ai"), numeric: true, cell: (r) => <bdi className="mz-num">{r.aiOffers}</bdi> },
  ];
  const body = !allowed ? <div className="mz-card"><EmptyState icon="locked" title={t("notAllowed.title")} body={t("notAllowed.body")} /></div>
    : !u ? <div className="mz-card"><SkeletonRows rows={4} label={t("loading")} /></div>
    : (
      <>
        <section className="mz-card flex flex-col gap-4 p-5" data-testid="usage">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-heading-sm">{t("thisMonth", { month: u.month })}</h2>
            <Badge tone="info" dot={false}>{t(`plan.${u.plan}`)}</Badge>
          </div>
          <Meter label={t("meters.orders")} used={u.usage.orders} limit={u.limits.ordersPerMonth} />
          <Meter label={t("meters.stores")} used={u.usage.stores} limit={u.limits.stores} />
          <Meter label={t("meters.users")} used={u.usage.users} limit={u.limits.users} />
          <p className="border-t border-line pt-3 text-body-sm text-text-2">
            {t.rich("atCost", { messages: u.usage.whatsappMessages, ai: u.usage.aiOffers, n: (c) => <bdi dir="ltr" className="mz-num">{c}</bdi> })}
          </p>
          <p className="text-caption text-text-3">{t("soft")}</p>
        </section>
        <DataTable label={t("history")} columns={columns} rows={u.history} rowKey={(r) => r.month} />
      </>
    );
  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-5 px-4 pt-6 pb-14 md:px-6">
      <SettingsTabs />
      <header>
        <h1 className="font-display text-heading-lg">{t("title")}</h1>
        <p className="mt-1 max-w-[70ch] text-body-sm text-text-2">{t("subtitle")}</p>
      </header>
      {body}
    </div>
  );
}

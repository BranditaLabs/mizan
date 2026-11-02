"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { buttonClass } from "@/components/ui/Button";
import { Cell, DataTable, IdCell, type Column } from "@/components/ui/DataTable";
import { EmptyState, Progress, SkeletonRows } from "@/components/ui/Surface";
import { Tabs } from "@/components/ui/Tabs";
import { DateText, MoneyText } from "@/components/ui/Values";
import { Link } from "@/i18n/navigation";
import { ok, type Schemas } from "@/lib/api/client";
import { useSession } from "@/lib/session";
import { MANAGERS, STATUS_TONE, SUPPLIER_READERS, VIEWERS, type PoStatus } from "./purchasing-ui";

type Row = Schemas["PurchaseOrderList"]["data"][number];
type View = "open" | "draft" | PoStatus | "all";
const VIEWS: readonly View[] = ["open", "draft", "received", "cancelled", "all"];

/**
 * M16 purchase orders (M16-2): what is still coming first (approved, sent, partly received),
 * then drafts and the record. Each row shows how much arrived; late ones are flagged.
 */
export function PurchaseOrdersScreen() {
  const t = useTranslations("purchasing");
  const { api, user, store } = useSession();
  const role = store?.role ?? "";
  const [view, setView] = useState<View>("open");
  const list = useQuery({
    queryKey: ["purchaseOrders", user?.uid ?? "", store?.tenantId ?? "", view],
    queryFn: () => ok(api.GET("/v1/purchase-orders", { params: { query: { limit: 100, ...(view === "all" ? {} : { status: view }) } } })),
    enabled: Boolean(store) && VIEWERS.has(role),
  });
  if (!VIEWERS.has(role)) return <div className="mx-auto max-w-[960px] px-4 pt-6 md:px-6"><div className="mz-card"><EmptyState icon="locked" title={t("notAllowed.title")} body={t("notAllowed.body")} /></div></div>;

  const counts = list.data?.counts;
  const count = (v: View) => !counts ? undefined : v === "open" ? counts.approved + counts.sent + counts.partially_received : v === "all" ? undefined : counts[v];
  const columns: Column<Row>[] = [
    { id: "po", header: t("columns.po"), cell: (r) => <Cell main={<Link href={`/purchasing/${r.id}`} className="hover:underline"><IdCell>{r.number}</IdCell></Link>} sub={<DateText value={r.createdAt} />} /> },
    { id: "supplier", header: t("columns.supplier"), cell: (r) => <bdi>{r.supplier.name}</bdi> },
    { id: "items", header: t("columns.items"), cell: (r) => <Cell main={t("itemsUnits", { items: r.items, units: r.units })} /> },
    { id: "total", header: t("columns.total"), numeric: true, cell: (r) => <MoneyText money={r.total} /> },
    { id: "expected", header: t("columns.expected"), cell: (r) => (r.late ? <Badge tone="danger">{t("late")}</Badge> : r.expectedAt ? <DateText value={r.expectedAt} /> : <span className="text-text-3">—</span>) },
    {
      id: "received", header: t("columns.received"),
      cell: (r) => {
        const pct = r.units ? Math.min(100, Math.round((r.receivedUnits / r.units) * 100)) : 0;
        return <div className="flex min-w-24 items-center gap-2"><Progress value={pct} label={t("receivedPct", { pct })} className="w-16" /><span className="mz-num text-caption text-text-2">{pct}%</span></div>;
      },
    },
    { id: "status", header: t("columns.status"), cell: (r) => <Badge tone={STATUS_TONE[r.status]}>{t(`status.${r.status}`)}</Badge> },
  ];
  const empty = <EmptyState icon="purchasing" title={t(view === "open" ? "emptyOpen.title" : "empty.title")} body={t(view === "open" ? "emptyOpen.body" : "empty.body")}
    action={MANAGERS.has(role) ? <Link href="/purchasing/new" className={buttonClass("primary", "md")}>{t("newPo")}</Link> : undefined} />;

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-5 px-4 pt-6 pb-14 md:px-6" data-testid="purchase-orders">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-heading-lg">{t("title")}</h1>
          <p className="mt-1 text-body-sm text-text-2">{t("subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {SUPPLIER_READERS.has(role) ? <Link href="/purchasing/suppliers" className={buttonClass("secondary", "md")}>{t("suppliers")}</Link> : null}
          {SUPPLIER_READERS.has(role) ? <Link href="/purchasing/reorder" className={buttonClass("secondary", "md")}>{t("reorder.title")}</Link> : null}
          {MANAGERS.has(role) ? <Link href="/purchasing/new" className={buttonClass("primary", "md")}>{t("newPo")}</Link> : null}
        </div>
      </header>
      <Tabs label={t("tabsLabel")} value={view} onChange={setView} items={VIEWS.map((v) => ({ value: v, label: t(`view.${v}`), ...(count(v) !== undefined ? { count: count(v)! } : {}) }))}>
        {list.isPending ? <div className="mz-card"><SkeletonRows rows={5} label={t("loading")} /></div>
          : <DataTable label={t("title")} columns={columns} rows={list.data?.data ?? []} rowKey={(r) => r.id} rowLabel={(r) => r.number} empty={empty} />}
      </Tabs>
    </div>
  );
}

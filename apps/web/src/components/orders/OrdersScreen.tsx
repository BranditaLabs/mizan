"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Badge, RiskMeter, Tag } from "@/components/ui/Badge";
import { Button, buttonClass } from "@/components/ui/Button";
import { Cell, DataTable, IdCell, type Column } from "@/components/ui/DataTable";
import { SearchInput } from "@/components/ui/Field";
import { EmptyState, SkeletonRows } from "@/components/ui/Surface";
import { Tabs } from "@/components/ui/Tabs";
import { DateText, MoneyText } from "@/components/ui/Values";
import { Link } from "@/i18n/navigation";
import { ok, type Schemas } from "@/lib/api/client";
import { useSession } from "@/lib/session";
import { MODE_ICON, STATUS_TONE, maskedLast4 } from "./order-ui";

type Order = Schemas["OrderPage"]["data"][number];
type Status = Order["status"];
export type StatusTab = Status | "all";

/** Tab order: the work first (components.md §1 "queues, not reports"), then the record. */
const TABS: readonly StatusTab[] = ["all", "new", "pending_confirmation", "confirmed", "shipped", "delivered", "cancelled", "returned"];
const isTab = (v: string | null): v is StatusTab => v !== null && (TABS as readonly string[]).includes(v);

/**
 * M1 order list (E5-1): status tabs with counts, search (order number or phone), newest first,
 * more on demand. The URL keeps the tab and search, so a link opens the same view.
 */
export function OrdersScreen({ initialStatus, initialQuery }: { initialStatus: string | null; initialQuery: string | null }) {
  const t = useTranslations("orders");
  const tm = useTranslations("payments.mode");
  const tp = useTranslations("payments.status");
  const { api, user, store } = useSession();
  const [status, setStatus] = useState<StatusTab>(isTab(initialStatus) ? initialStatus : "all");
  const [text, setText] = useState(initialQuery ?? "");
  const [q, setQ] = useState((initialQuery ?? "").trim());
  const [now] = useState(() => Date.now());

  // Type, pause, search: one request per pause, not per key.
  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(id);
  }, [text]);

  // Shareable URL without a server round trip.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (status === "all") params.delete("status"); else params.set("status", status);
    if (q) params.set("q", q); else params.delete("q");
    const search = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${search ? `?${search}` : ""}`);
  }, [status, q]);

  const orders = useInfiniteQuery({
    queryKey: ["orders", user?.uid ?? "", store?.tenantId ?? "", status, q],
    queryFn: ({ pageParam }) => ok(api.GET("/v1/orders", { params: { query: {
      ...(status === "all" ? {} : { status }), ...(q ? { q } : {}), limit: 50, ...(pageParam ? { cursor: pageParam } : {}),
    } } })),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(store),
  });
  const rows = orders.data?.pages.flatMap((p) => p.data) ?? [];
  const counts = orders.data?.pages[0]?.counts;
  const canSetUp = store?.role === "owner" || store?.role === "admin";

  const columns: Column<Order>[] = [
    { id: "order", header: t("columns.order"), cell: (o) => <Cell main={<Link href={`/orders/${o.id}`} className="hover:underline"><IdCell>{o.number}</IdCell></Link>} sub={o.store.provider ?? t("manual")} /> },
    {
      id: "customer", header: t("columns.customer"),
      cell: (o) => <Cell main={o.customer.label ?? <span className="text-text-3">{t("noCustomer")}</span>} sub={o.customer.phoneLast4 ? <IdCell>{maskedLast4(o.customer.phoneLast4)}</IdCell> : null} />,
    },
    { id: "payment", header: t("columns.payment"), cell: (o) => <Cell main={<Tag icon={MODE_ICON[o.paymentMode]}>{tm(o.paymentMode)}</Tag>} sub={tp(o.paymentStatus)} /> },
    {
      id: "total", header: t("columns.total"), numeric: true,
      cell: (o) => <Cell main={<MoneyText money={o.total} />} sub={Number(o.cod.amount) > 0 ? t.rich("cod", { amount: "", m: () => <MoneyText money={o.cod} /> }) : null} />,
    },
    { id: "risk", header: t("columns.risk"), cell: (o) => (o.risk === null ? <span className="text-text-3">{t("noRisk")}</span> : <RiskMeter score={o.risk} label={t("riskLabel", { score: o.risk })} />) },
    { id: "status", header: t("columns.status"), cell: (o) => <Badge tone={STATUS_TONE[o.status]}>{t(`status.${o.status}`)}</Badge> },
    { id: "age", header: t("columns.age"), cell: (o) => <span className="text-text-2"><DateText relative now={now} value={o.placedAt} /></span> },
  ];

  const empty = q ? <EmptyState icon="search" title={t("noMatch.title")} body={t("noMatch.body")} />
    : counts?.all === 0 ? (
      <EmptyState icon="orders" title={t("empty.title")} body={t("empty.body")}
        action={canSetUp ? <Link href="/onboarding" className={buttonClass("primary")}>{t("empty.cta")}</Link> : undefined} />
    ) : <EmptyState icon="orders" title={t("emptyTab.title")} body={t("emptyTab.body")} />;

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-5 px-4 pt-6 pb-14 md:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-heading-lg">{t("title")}</h1>
          <p className="mt-1 text-body-sm text-text-2">{t("subtitle")}</p>
        </div>
        <SearchInput label={t("search")} placeholder={t("search")} value={text} onChange={(e) => setText(e.target.value)} className="w-full sm:w-80" />
      </header>

      <Tabs label={t("tabsLabel")} value={status} onChange={setStatus}
        items={TABS.map((s) => ({ value: s, label: s === "all" ? t("all") : t(`status.${s}`), ...(counts ? { count: counts[s] } : {}) }))}>
        {orders.isPending ? (
          <div className="mz-card"><SkeletonRows rows={6} label={t("loading")} /></div>
        ) : (
          <div className="flex flex-col gap-3">
            <DataTable label={t("label")} columns={columns} rows={rows} rowKey={(o) => o.id} empty={empty} />
            {orders.hasNextPage ? (
              <div className="flex justify-center">
                <Button variant="secondary" busy={orders.isFetchingNextPage} onClick={() => void orders.fetchNextPage()}>{t("more")}</Button>
              </div>
            ) : null}
          </div>
        )}
      </Tabs>
    </div>
  );
}

"use client";

import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Tag } from "@/components/ui/Badge";
import { Button, ButtonGroup } from "@/components/ui/Button";
import { Cell, DataTable, IdCell, type Column } from "@/components/ui/DataTable";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState, SkeletonRows } from "@/components/ui/Surface";
import { DateText, MoneyText } from "@/components/ui/Values";
import { BulkProgress } from "@/components/orders/BulkActions";
import { MODE_ICON, maskedLast4 } from "@/components/orders/order-ui";
import { Link } from "@/i18n/navigation";
import { ok, type Schemas } from "@/lib/api/client";
import { useSession } from "@/lib/session";

type Order = Schemas["OrderPage"]["data"][number];
/** Who ships from this screen: managers and the warehouse (the API checks too). */
export const SHIP_ROLES = new Set(["owner", "admin", "ops_manager", "warehouse"]);

/** Confirmed orders with no courier yet (E7-2); the key starts with "orders" so a finished bulk action refreshes it. */
export function useReadyToShip(q: string) {
  const { api, user, store } = useSession();
  return useInfiniteQuery({
    queryKey: ["orders", "ready-to-ship", user?.uid ?? "", store?.tenantId ?? "", q],
    queryFn: ({ pageParam }) => ok(api.GET("/v1/orders", { params: { query: { shipping: "ready", ...(q ? { q } : {}), limit: 50, ...(pageParam ? { cursor: pageParam } : {}) } } })),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(store),
  });
}

/**
 * M3 (E7-2): what is ready for the courier — confirmed, not waiting for stock or a duplicate
 * decision, no shipment yet. Select and ship them in one go: the worker books each order as the
 * order screen does (the cash to collect from the payment, one booking per order) and the panel
 * says which were skipped and why. Labels follow once the courier's label API is confirmed.
 */
export function ReadyToShip({ q, now }: { q: string; now: number }) {
  const t = useTranslations("shipments.ready");
  const to = useTranslations("orders");
  const tm = useTranslations("payments.mode");
  const { api, store } = useSession();
  const list = useReadyToShip(q);
  const [bulkId, setBulkId] = useState<string | null>(null);
  const [asking, setAsking] = useState<{ ids: string[]; clear(): void } | null>(null);
  const start = useMutation({
    mutationFn: (orderIds: string[]) => ok(api.POST("/v1/orders/bulk", { body: { action: "ship", orderIds } })),
    onSuccess: (b) => { asking?.clear(); setAsking(null); setBulkId(b.id); },
    onError: () => setAsking(null),
  });
  const canShip = SHIP_ROLES.has(store?.role ?? "");
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  const columns: Column<Order>[] = [
    { id: "order", header: to("columns.order"), cell: (o) => <Cell main={<Link href={`/orders/${o.id}`} className="hover:underline"><IdCell>{o.number}</IdCell></Link>} sub={<DateText relative now={now} value={o.placedAt} />} /> },
    { id: "customer", header: to("columns.customer"), cell: (o) => <Cell main={o.customer.label ?? "—"} sub={o.customer.phoneLast4 ? <IdCell>{maskedLast4(o.customer.phoneLast4)}</IdCell> : null} /> },
    { id: "payment", header: to("columns.payment"), cell: (o) => <Tag icon={MODE_ICON[o.paymentMode]}>{tm(o.paymentMode)}</Tag> },
    { id: "cod", header: t("cod"), numeric: true, cell: (o) => <MoneyText money={o.cod} /> },
  ];
  if (list.isPending) return <div className="mz-card"><SkeletonRows rows={5} label={t("loading")} /></div>;
  return (
    <div className="flex flex-col gap-3" data-testid="ready-to-ship">
      {bulkId ? <BulkProgress id={bulkId} onClose={() => setBulkId(null)} /> : null}
      <DataTable label={t("title")} columns={columns} rows={rows} rowKey={(o) => o.id} rowLabel={(o) => o.number}
        empty={<EmptyState icon="shipping" title={t("empty.title")} body={t("empty.body")} />}
        selectable={canShip} bulkActions={(keys, clear) => (
          <ButtonGroup>
            <Button size="sm" icon="shipping" onClick={() => setAsking({ ids: [...keys], clear })}>{t("ship")}</Button>
          </ButtonGroup>
        )} />
      {list.hasNextPage ? <div className="flex justify-center"><Button variant="secondary" busy={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>{t("more")}</Button></div> : null}
      <Dialog open={asking !== null} onClose={() => setAsking(null)} title={t("askTitle", { count: asking?.ids.length ?? 0 })} description={t("askBody")} footer={(
        <ButtonGroup>
          <Button busy={start.isPending} onClick={() => asking && start.mutate(asking.ids)}>{t("go")}</Button>
          <Button variant="ghost" onClick={() => setAsking(null)}>{t("close")}</Button>
        </ButtonGroup>
      )} />
    </div>
  );
}

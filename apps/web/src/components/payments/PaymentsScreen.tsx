"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Badge, Tag } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Cell, DataTable, IdCell, type Column } from "@/components/ui/DataTable";
import { SearchInput } from "@/components/ui/Field";
import { EmptyState, KeyValue, SkeletonRows } from "@/components/ui/Surface";
import { Tabs } from "@/components/ui/Tabs";
import { DateText, MoneyText } from "@/components/ui/Values";
import { Link } from "@/i18n/navigation";
import { ok, type Schemas } from "@/lib/api/client";
import { useSession } from "@/lib/session";
import { MODE_ICON } from "@/components/orders/order-ui";

type Row = Schemas["PaymentPage"]["data"][number];
type View = "all" | "unpaid" | "paid" | "cod_due" | "refunds" | "disputes";
const VIEWS: readonly View[] = ["all", "unpaid", "cod_due", "paid", "refunds", "disputes"];
const READERS = new Set(["owner", "admin", "ops_manager", "finance"]);
const METHODS = new Set(["cod", "card", "wallet", "apple_pay", "bnpl", "bank_transfer", "instapay", "fawry_ref", "store_credit", "cash_pos", "marketplace"]);
const STATUS_TONE: Partial<Record<Row["status"], "success" | "warning" | "danger" | "info">> = {
  paid: "success", partially_paid: "info", authorized: "info", unpaid: "warning", failed: "danger", disputed: "danger", refunded: "warning", partially_refunded: "warning",
};
const isZero = (m: { amount: string }) => Number(m.amount) === 0;

/**
 * M15 payments (E14-6): every order by where its money stands — waiting for money, cash still to
 * collect, paid, refunded, disputed — with what was paid and is still owed, and the view's sums.
 */
export function PaymentsScreen() {
  const t = useTranslations("paymentsScreen");
  const tm = useTranslations("payments.mode");
  const tp = useTranslations("payments.status");
  const td = useTranslations("orders.detail.method");
  const { api, user, store } = useSession();
  const allowed = READERS.has(store?.role ?? "");
  const [view, setView] = useState<View>("all");
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [now] = useState(() => Date.now());
  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(id);
  }, [text]);
  const list = useInfiniteQuery({
    queryKey: ["payments", user?.uid ?? "", store?.tenantId ?? "", view, q],
    queryFn: ({ pageParam }) => ok(api.GET("/v1/payments", { params: { query: { view, ...(q ? { q } : {}), limit: 50, ...(pageParam ? { cursor: pageParam } : {}) } } })),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(store) && allowed,
  });
  const frame = (body: React.ReactNode) => (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-5 px-4 pt-6 pb-14 md:px-6" data-testid="payments">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-heading-lg">{t("title")}</h1>
          <p className="mt-1 max-w-[70ch] text-body-sm text-text-2">{t("subtitle")}</p>
        </div>
        {allowed ? <SearchInput label={t("search")} placeholder={t("search")} value={text} onChange={(e) => setText(e.target.value)} className="w-full sm:w-72" /> : null}
      </header>
      {body}
    </div>
  );
  if (!allowed) return frame(<div className="mz-card"><EmptyState icon="locked" title={t("notAllowed.title")} body={t("notAllowed.body")} /></div>);

  const first = list.data?.pages[0];
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  const method = (m: string) => (METHODS.has(m) ? td(m as "cod") : m);
  const columns: Column<Row>[] = [
    { id: "order", header: t("columns.order"), cell: (r) => <Cell main={<Link href={`/orders/${r.order.id}`} className="hover:underline"><IdCell>{r.order.number}</IdCell></Link>} sub={<DateText relative now={now} value={r.order.placedAt} />} /> },
    { id: "method", header: t("columns.method"), cell: (r) => <Cell main={<Tag icon={MODE_ICON[r.mode]}>{tm(r.mode)}</Tag>} sub={r.methods.length ? r.methods.map(method).join("، ") : null} /> },
    { id: "total", header: t("columns.total"), numeric: true, cell: (r) => <MoneyText money={r.total} /> },
    { id: "paid", header: t("columns.paid"), numeric: true, cell: (r) => <Cell main={<MoneyText money={r.paid} />} sub={isZero(r.refunded) ? null : t.rich("refunded", { m: () => <MoneyText money={r.refunded} /> })} /> },
    { id: "balance", header: t("columns.balance"), numeric: true, cell: (r) => <Cell main={<MoneyText money={r.balance} />} sub={isZero(r.cod) ? null : t.rich("cod", { m: () => <MoneyText money={r.cod} /> })} /> },
    { id: "status", header: t("columns.status"), cell: (r) => <Badge tone={STATUS_TONE[r.status] ?? "neutral"}>{tp(r.status)}</Badge> },
  ];
  const empty = q ? <EmptyState icon="search" title={t("noMatch.title")} body={t("noMatch.body")} /> : <EmptyState icon="payments" title={t(`empty.${view}.title`)} body={t(`empty.${view}.body`)} />;
  return frame(
    <Tabs label={t("tabsLabel")} value={view} onChange={setView} items={VIEWS.map((v) => ({ value: v, label: t(`view.${v}`), ...(first ? { count: first.counts[v] } : {}) }))}>
      {list.isPending ? <div className="mz-card"><SkeletonRows rows={5} label={t("loading")} /></div> : (
        <div className="flex flex-col gap-3">
          {first?.totals.length ? (
            <div className="grid gap-3 md:grid-cols-2" data-testid="payment-totals">
              {first.totals.map((s) => (
                <div key={s.currency} className="mz-card p-4">
                  <KeyValue items={[
                    { label: t("totals.total"), value: <MoneyText money={s.total} /> },
                    { label: t("totals.paid"), value: <MoneyText money={s.paid} /> },
                    ...(isZero(s.refunded) ? [] : [{ label: t("totals.refunded"), value: <MoneyText money={s.refunded} /> }]),
                    { label: t("totals.balance"), value: <strong><MoneyText money={s.balance} /></strong> },
                    ...(isZero(s.cod) ? [] : [{ label: t("totals.cod"), value: <MoneyText money={s.cod} /> }]),
                  ]} />
                </div>
              ))}
            </div>
          ) : null}
          <DataTable label={t("title")} columns={columns} rows={rows} rowKey={(r) => r.order.id} rowLabel={(r) => r.order.number} empty={empty} />
          {list.hasNextPage ? <div className="flex justify-center"><Button variant="secondary" busy={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>{t("more")}</Button></div> : null}
        </div>
      )}
    </Tabs>,
  );
}

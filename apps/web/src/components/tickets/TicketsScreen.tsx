"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Cell, DataTable, IdCell, type Column } from "@/components/ui/DataTable";
import { SearchInput } from "@/components/ui/Field";
import { EmptyState, SkeletonRows } from "@/components/ui/Surface";
import { Tabs } from "@/components/ui/Tabs";
import { DateText } from "@/components/ui/Values";
import { Link, useRouter } from "@/i18n/navigation";
import { ok, type Schemas } from "@/lib/api/client";
import { useSession } from "@/lib/session";
import { NewTicketDialog } from "./NewTicketDialog";
import { CREATE_ROLES, STATUS_TONE } from "./ticket-ui";

type Row = Schemas["TicketPage"]["data"][number];
type View = "active" | "open" | "waiting" | "inspection" | "late" | "resolved" | "closed" | "all";
const VIEWS: readonly View[] = ["active", "late", "open", "waiting", "inspection", "resolved", "closed", "all"];

/**
 * M6 tickets (E10-1): the work first (still open, late), then the record. Search by ticket or
 * order number; open a ticket from here or from its order.
 */
export function TicketsScreen() {
  const t = useTranslations("tickets");
  const { api, user, store } = useSession();
  const router = useRouter();
  const [view, setView] = useState<View>("active");
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [now] = useState(() => Date.now());
  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(id);
  }, [text]);

  const list = useInfiniteQuery({
    queryKey: ["tickets", user?.uid ?? "", store?.tenantId ?? "", view, q],
    queryFn: ({ pageParam }) => ok(api.GET("/v1/tickets", { params: { query: { view, ...(q ? { q } : {}), limit: 50, ...(pageParam ? { cursor: pageParam } : {}) } } })),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(store),
  });
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  const counts = list.data?.pages[0]?.counts;
  const columns: Column<Row>[] = [
    { id: "ticket", header: t("columns.ticket"), cell: (r) => <Cell main={<Link href={`/tickets/${r.id}`} className="hover:underline"><IdCell>{r.number}</IdCell></Link>} sub={t(`source.${r.source}`)} /> },
    { id: "order", header: t("columns.order"), cell: (r) => (r.order ? <Link href={`/orders/${r.order.id}`} className="hover:underline"><IdCell>{r.order.number}</IdCell></Link> : <span className="text-text-3">{t("noOrder")}</span>) },
    { id: "type", header: t("columns.type"), cell: (r) => <Cell main={t(`type.${r.type}`)} sub={r.reason ? t(`reason.${r.reason}`) : null} /> },
    { id: "status", header: t("columns.status"), cell: (r) => <Badge tone={STATUS_TONE[r.status]}>{t(`status.${r.status}`)}</Badge> },
    { id: "assignee", header: t("columns.assignee"), cell: (r) => (r.assignee ? <bdi>{r.assignee.name ?? t("member")}</bdi> : <span className="text-text-3">{t("unassigned")}</span>) },
    {
      id: "due", header: t("columns.due"),
      cell: (r) => (r.late ? <Badge tone="danger">{t("late")}</Badge>
        : r.dueAt && r.status !== "resolved" && r.status !== "closed" ? <span className="text-text-2"><DateText relative now={now} value={r.dueAt} /></span>
        : <span className="text-text-3">—</span>),
    },
  ];
  const empty = q ? <EmptyState icon="search" title={t("noMatch.title")} body={t("noMatch.body")} />
    : <EmptyState icon="returns" title={t(view === "late" ? "emptyLate.title" : "empty.title")} body={t(view === "late" ? "emptyLate.body" : "empty.body")} />;

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-5 px-4 pt-6 pb-14 md:px-6" data-testid="tickets">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-heading-lg">{t("title")}</h1>
          <p className="mt-1 text-body-sm text-text-2">{t("subtitle")}</p>
        </div>
        <div className="flex w-full flex-wrap items-end gap-3 sm:w-auto">
          <SearchInput label={t("search")} placeholder={t("search")} value={text} onChange={(e) => setText(e.target.value)} className="w-full sm:w-72" />
          {CREATE_ROLES.has(store?.role ?? "") ? <Button icon="add" onClick={() => setCreating(true)}>{t("newTicket")}</Button> : null}
        </div>
      </header>
      <Tabs label={t("tabsLabel")} value={view} onChange={setView} items={VIEWS.map((v) => ({ value: v, label: t(`view.${v}`), ...(counts && v !== "all" ? { count: counts[v] } : {}) }))}>
        {list.isPending ? <div className="mz-card"><SkeletonRows rows={5} label={t("loading")} /></div> : (
          <div className="flex flex-col gap-3">
            <DataTable label={t("title")} columns={columns} rows={rows} rowKey={(r) => r.id} rowLabel={(r) => r.number} empty={empty} />
            {list.hasNextPage ? (
              <div className="flex justify-center"><Button variant="secondary" busy={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>{t("more")}</Button></div>
            ) : null}
          </div>
        )}
      </Tabs>
      {creating ? <NewTicketDialog onClose={() => setCreating(false)} onCreated={(ticket) => router.push(`/tickets/${ticket.id}`)} /> : null}
    </div>
  );
}

"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Cell, DataTable, IdCell, type Column } from "@/components/ui/DataTable";
import { Dialog } from "@/components/ui/Dialog";
import { SearchInput, Select, TextArea } from "@/components/ui/Field";
import { EmptyState, SkeletonRows } from "@/components/ui/Surface";
import { Tabs } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";
import { DateText, MoneyText } from "@/components/ui/Values";
import { Link } from "@/i18n/navigation";
import { ok, type Schemas } from "@/lib/api/client";
import { useSession } from "@/lib/session";
import { ReadyToShip, useReadyToShip } from "./ReadyToShip";
import { Scorecard } from "./Scorecard";
import { StatusImport } from "./StatusImport";

type Row = Schemas["ShipmentPage"]["data"][number];
type ShipmentView = "active" | "review" | "delivered" | "returned" | "all";
type View = "ready" | ShipmentView;
const VIEWS: readonly View[] = ["ready", "active", "review", "delivered", "returned", "all"];
const MANAGERS = new Set(["owner", "admin", "ops_manager"]);
const STATUSES = ["created", "pickup_requested", "picked_up", "in_transit", "out_for_delivery", "failed_attempt", "delivered", "returning", "returned", "cancelled", "lost", "unknown"] as const;
type Status = (typeof STATUSES)[number];
const SETTABLE = STATUSES.filter((s) => s !== "unknown");
const isStatus = (s: string): s is Status => (STATUSES as readonly string[]).includes(s);
const ERRORS = new Set(["city_unknown", "address_invalid", "payment_blocks", "cancelled", "not_found", "courier_refused_key", "courier_failed"]);
const TONE: Partial<Record<Status, "success" | "danger" | "warning" | "info">> = { delivered: "success", returned: "danger", lost: "danger", returning: "warning", failed_attempt: "warning", out_for_delivery: "info", unknown: "warning" };
const providerName = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * M3 shipping: what is ready to ship, shipped in one go (E7-2), then every shipment with the
 * courier and where it is (E7-3), and the review queue — a
 * status the courier sent that Mizan could not map, a final status the courier later contradicted,
 * or a booking it refused. Managers set the status once they know (audited); never guessed.
 */
export function ShipmentsScreen() {
  const t = useTranslations("shipments");
  const ts = useTranslations("shipping");
  const { api, user, store } = useSession();
  const [view, setView] = useState<View>("ready");
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Row | null>(null);
  const [importing, setImporting] = useState(false);
  const [now] = useState(() => Date.now());
  const manager = MANAGERS.has(store?.role ?? "");
  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(id);
  }, [text]);
  // The ready tab lists orders; the shipments list behind it still gives the other tabs' counts.
  const shipmentView: ShipmentView = view === "ready" ? "active" : view;
  const ready = useReadyToShip(q);
  const list = useInfiniteQuery({
    queryKey: ["shipments", user?.uid ?? "", store?.tenantId ?? "", shipmentView, q],
    queryFn: ({ pageParam }) => ok(api.GET("/v1/shipments", { params: { query: { view: shipmentView, ...(q ? { q } : {}), limit: 50, ...(pageParam ? { cursor: pageParam } : {}) } } })),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(store),
  });
  const first = list.data?.pages[0];
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  const statusLabel = (s: string) => (isStatus(s) ? ts(`status.${s}`) : s);
  const columns: Column<Row>[] = [
    { id: "order", header: t("columns.order"), cell: (r) => <Cell main={<Link href={`/orders/${r.order.id}`} className="hover:underline"><IdCell>{r.order.number}</IdCell></Link>} sub={<DateText relative now={now} value={r.createdAt} />} /> },
    { id: "tracking", header: t("columns.tracking"), cell: (r) => <Cell main={r.trackingNumber ? (r.trackingUrl ? <a href={r.trackingUrl} target="_blank" rel="noreferrer" className="hover:underline"><IdCell>{r.trackingNumber}</IdCell></a> : <IdCell>{r.trackingNumber}</IdCell>) : "—"} sub={providerName(r.provider)} /> },
    { id: "area", header: t("columns.area"), cell: (r) => <Cell main={<span dir="auto">{r.area.city ?? "—"}</span>} sub={r.area.province ? <span dir="auto">{r.area.province}</span> : null} /> },
    { id: "status", header: t("columns.status"), cell: (r) => (
      <Cell
        main={r.booking === "failed" ? <Badge tone="danger">{ts("booking.failed")}</Badge> : r.booking === "pending" ? <Badge tone="info">{ts("booking.pending")}</Badge>
          : <Badge tone={TONE[r.status as Status] ?? "neutral"}>{statusLabel(r.status)}</Badge>}
        sub={r.booking === "failed" && r.errorCode ? (ERRORS.has(r.errorCode) ? ts(`error.${r.errorCode as "city_unknown"}`) : null)
          : r.needsReview ? <span>{t("courierSaid")}{" "}<span dir="auto" className="font-medium">{r.statusRaw ?? "—"}</span></span>
          : r.statusAt ? <DateText relative now={now} value={r.statusAt} /> : null}
      />
    ) },
    { id: "cod", header: t("columns.cod"), numeric: true, cell: (r) => <MoneyText money={r.cod} /> },
    ...(manager && view === "review" ? [{ id: "act", header: t("columns.action"), cell: (r: Row) => r.booking === "booked"
      ? <Button size="sm" variant="secondary" onClick={() => setEditing(r)}>{t("set.open")}</Button>
      : <Link href={`/orders/${r.order.id}`} className="text-body-sm underline">{t("openOrder")}</Link> }] : []),
  ];
  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-5 px-4 pt-6 pb-14 md:px-6" data-testid="shipments">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-heading-lg">{t("title")}</h1>
          <p className="mt-1 max-w-[70ch] text-body-sm text-text-2">{t("subtitle")}</p>
        </div>
        <div className="flex w-full flex-wrap items-end gap-2 sm:w-auto">
          {manager ? <Button variant="secondary" icon="upload" onClick={() => setImporting(true)}>{t("import.open")}</Button> : null}
          <SearchInput label={t("search")} placeholder={t("search")} value={text} onChange={(e) => setText(e.target.value)} className="w-full sm:w-72" />
        </div>
      </header>
      <Tabs label={t("tabsLabel")} value={view} onChange={setView} items={VIEWS.map((v) => ({ value: v, label: t(`view.${v}`), ...(v === "ready" ? (ready.data ? { count: ready.data.pages[0]!.readyToShip } : {}) : first ? { count: first.counts[v] } : {}) }))}>
        {view === "ready" ? <ReadyToShip q={q} now={now} /> : list.isPending ? <div className="mz-card"><SkeletonRows rows={5} label={t("loading")} /></div> : (
          <div className="flex flex-col gap-3">
            <DataTable label={t("title")} columns={columns} rows={rows} rowKey={(r) => r.id} rowLabel={(r) => r.order.number}
              empty={q ? <EmptyState icon="search" title={t("noMatch.title")} body={t("noMatch.body")} /> : <EmptyState icon="shipping" title={t(`empty.${shipmentView}.title`)} body={t(`empty.${shipmentView}.body`)} />} />
            {list.hasNextPage ? <div className="flex justify-center"><Button variant="secondary" busy={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>{t("more")}</Button></div> : null}
          </div>
        )}
      </Tabs>
      <Scorecard />
      {editing ? <SetStatusDialog row={editing} onClose={() => setEditing(null)} /> : null}
      <StatusImport open={importing} onClose={() => setImporting(false)} />
    </div>
  );
}

function SetStatusDialog({ row, onClose }: { row: Row; onClose(): void }) {
  const t = useTranslations("shipments.set");
  const ts = useTranslations("shipping");
  const { api } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState<string>(row.status === "unknown" ? "" : row.status);
  const [note, setNote] = useState("");
  const save = useMutation({
    mutationFn: () => ok(api.POST("/v1/shipments/{id}/status", { params: { path: { id: row.id } }, body: { status: status as Schemas["SetShipmentStatus"]["status"], ...(note.trim() ? { note: note.trim() } : {}) } })),
    onSuccess: () => {
      toast({ message: t("saved") });
      void qc.invalidateQueries({ queryKey: ["shipments"] });
      void qc.invalidateQueries({ queryKey: ["scorecard"] });
      onClose();
    },
  });
  return (
    <Dialog open onClose={onClose} title={t("title", { number: row.order.number })} description={t("body")} footer={(
      <>
        <Button variant="secondary" onClick={onClose}>{t("cancel")}</Button>
        <Button busy={save.isPending} disabled={!status} onClick={() => save.mutate()}>{t("save")}</Button>
      </>
    )}>
      <div className="flex flex-col gap-3">
        {row.statusRaw ? <p className="text-body-sm text-text-2">{t("courierSaid")}{" "}<span dir="auto" className="font-medium text-text">{row.statusRaw}</span></p> : null}
        <Select label={t("status")} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="" disabled>{t("pick")}</option>
          {SETTABLE.map((s) => <option key={s} value={s}>{ts(`status.${s}`)}</option>)}
        </Select>
        <TextArea label={t("note")} hint={t("noteHint")} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} dir="auto" />
      </div>
    </Dialog>
  );
}

"use client";

import { toAsciiDigits } from "@mizan/shared";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Bdi } from "@/components/Bdi";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Switch } from "@/components/ui/Choice";
import { Button, ButtonGroup, buttonClass } from "@/components/ui/Button";
import { Cell, DataTable, IdCell, type Column } from "@/components/ui/DataTable";
import { Dialog } from "@/components/ui/Dialog";
import { Field, SearchInput, Select } from "@/components/ui/Field";
import { StatCard } from "@/components/ui/StatCard";
import { EmptyState, SkeletonRows } from "@/components/ui/Surface";
import { Tabs } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";
import { DateText } from "@/components/ui/Values";
import { Link } from "@/i18n/navigation";
import { ApiError, ok, type Schemas } from "@/lib/api/client";
import { useSession } from "@/lib/session";

type Row = Schemas["StockPage"]["data"][number];
type Filter = "all" | "counted" | "not_counted" | "low" | "out";
type Kind = "receive" | "count" | "adjust";
type Reason = "damaged" | "lost" | "found" | "correction" | "other";
const FILTERS: readonly Filter[] = ["all", "counted", "not_counted", "low", "out"];
const KINDS: readonly Kind[] = ["receive", "count", "adjust"];
const REASONS: readonly Reason[] = ["damaged", "lost", "found", "correction", "other"];
const READERS = new Set(["owner", "admin", "ops_manager", "warehouse", "finance"]);
const WRITERS = new Set(["owner", "admin", "ops_manager", "warehouse"]);
const MANAGERS = new Set(["owner", "admin", "ops_manager"]);

/**
 * Stock (M4, E8-2): on hand, reserved for confirmed orders, and available, in the main warehouse.
 * An item is counted here once it is received or counted; from then on confirmed orders reserve
 * it, and an order that would oversell waits until stock arrives.
 */
export function StockScreen() {
  const t = useTranslations("stock");
  const { api, user, store } = useSession();
  const allowed = READERS.has(store?.role ?? "");
  const canWrite = WRITERS.has(store?.role ?? "");
  const [filter, setFilter] = useState<Filter>("all");
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Row | null>(null);
  const [history, setHistory] = useState<Row | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(id);
  }, [text]);

  const stock = useInfiniteQuery({
    queryKey: ["stock", user?.uid ?? "", store?.tenantId ?? "", filter, q],
    queryFn: ({ pageParam }) => ok(api.GET("/v1/stock", { params: { query: { filter, ...(q ? { search: q } : {}), limit: 50, ...(pageParam ? { cursor: pageParam } : {}) } } })),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(store) && allowed,
  });

  const frame = (body: React.ReactNode) => (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-5 px-4 pt-6 pb-14 md:px-6" data-testid="stock">
      <header>
        <h1 className="font-display text-heading-lg">{t("title")}</h1>
        <p className="mt-1 max-w-[70ch] text-body-sm text-text-2">{t("subtitle")}</p>
      </header>
      {body}
    </div>
  );
  if (!allowed) return frame(<div className="mz-card"><EmptyState icon="locked" title={t("notAllowed.title")} body={t("notAllowed.body")} /></div>);

  const first = stock.data?.pages[0];
  const counts = first?.counts;
  const rows = (stock.data?.pages ?? []).flatMap((p) => p.data);
  const num = (n: number | null) => (n === null ? <span className="text-text-3">{t("none")}</span> : <Bdi>{n}</Bdi>);
  const columns: Column<Row>[] = [
    { id: "product", header: t("col.product"), cell: (r) => <Cell main={r.productTitle} sub={r.variantTitle} /> },
    { id: "sku", header: t("col.sku"), cell: (r) => <IdCell>{r.sku}</IdCell> },
    { id: "onHand", header: t("col.onHand"), numeric: true, cell: (r) => num(r.onHand), sortValue: (r) => r.onHand ?? -1 },
    { id: "reserved", header: t("col.reserved"), numeric: true, cell: (r) => num(r.reserved), sortValue: (r) => r.reserved ?? -1 },
    {
      id: "available", header: t("col.available"), numeric: true, sortValue: (r) => r.available ?? -1,
      cell: (r) => !r.counted ? <Badge tone="neutral" dot={false}>{t("notCounted")}</Badge>
        : r.available! <= 0 ? <Badge tone="danger"><Bdi>{r.available!}</Bdi></Badge>
        : r.lowStockAt !== null && r.available! <= r.lowStockAt ? <Badge tone="warning"><Bdi>{r.available!}</Bdi></Badge> : <Bdi>{r.available!}</Bdi>,
    },
    { id: "store", header: t("col.store"), numeric: true, cell: (r) => num(r.storeAvailable) },
    {
      id: "actions", header: t("col.actions"),
      cell: (r) => (
        <span className="inline-flex gap-1">
          {canWrite ? <Button size="sm" variant="ghost" icon="edit" onClick={() => setEditing(r)} aria-label={t("updateLabel", { sku: r.sku })}>{t("update")}</Button> : null}
          {r.counted ? <Button size="sm" variant="ghost" onClick={() => setHistory(r)} aria-label={t("historyLabel", { sku: r.sku })}>{t("history")}</Button> : null}
        </span>
      ),
    },
  ];
  const empty = q ? <EmptyState icon="search" title={t("noMatch.title")} body={t("noMatch.body")} />
    : counts?.variants === 0 ? <EmptyState icon="stock" title={t("empty.title")} body={t("empty.body")} />
    : <EmptyState icon="success" title={t("emptyTab.title")} body={t("emptyTab.body")} />;

  return frame(
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="stock-counts">
        <StatCard label={t("count.counted")} value={counts ? t("countedOf", { counted: counts.counted, variants: counts.variants }) : "…"} />
        <StatCard label={t("count.out")} value={counts?.out ?? "…"} />
        <StatCard label={t("count.low")} value={counts?.low ?? "…"} />
        <StatCard label={t("count.waiting")} value={counts?.waitingOrders ?? "…"} />
      </div>
      {counts && counts.waitingOrders > 0 ? (
        <Alert tone="warning" title={t("waiting.title", { count: counts.waitingOrders })}>
          <span className="flex flex-wrap items-center gap-3">
            {t("waiting.body")}
            <Link href="/orders?status=waiting_stock" className={buttonClass("secondary", "sm")}>{t("waiting.cta")}</Link>
          </span>
        </Alert>
      ) : null}
      {MANAGERS.has(store?.role ?? "") ? <StoreSync /> : null}
      <Tabs label={t("filterLabel")} value={filter} onChange={setFilter} items={FILTERS.map((f) => ({ value: f, label: t(`filter.${f}`) }))}>
        <div className="flex flex-col gap-3">
          <SearchInput label={t("search")} placeholder={t("search")} value={text} onChange={(e) => setText(e.target.value)} className="w-full sm:w-80" />
          {stock.isPending ? <div className="mz-card"><SkeletonRows rows={6} label={t("loading")} /></div> : null}
          {stock.isError ? <Alert tone="danger">{t("loadFailed")}</Alert> : null}
          {stock.data ? <DataTable label={t("label")} columns={columns} rows={rows} rowKey={(r) => r.variantId} rowLabel={(r) => r.sku} empty={empty} /> : null}
          {stock.hasNextPage ? (
            <div className="flex justify-center">
              <Button variant="secondary" busy={stock.isFetchingNextPage} onClick={() => void stock.fetchNextPage()}>{t("more")}</Button>
            </div>
          ) : null}
          <p className="text-caption text-text-3">{t("rule")}</p>
        </div>
      </Tabs>
      {editing ? <UpdateStock row={editing} onClose={() => setEditing(null)} /> : null}
      {history ? <History row={history} onClose={() => setHistory(null)} /> : null}
    </>,
  );
}

/** Receive, count or adjust one item; the API refuses to go under what confirmed orders hold. */
function UpdateStock({ row, onClose }: { row: Row; onClose(): void }) {
  const t = useTranslations("stock.editor");
  const { api } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [kind, setKind] = useState<Kind>(row.counted ? "receive" : "count");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState<Reason | "">("");
  const [note, setNote] = useState("");
  const value = toAsciiDigits(quantity.trim()).replace(/^\+/, "");
  const n = /^-?\d{1,6}$/.test(value) ? Number(value) : null;
  const valid = n !== null && (kind === "receive" ? n > 0 : kind === "count" ? n >= 0 : n !== 0) && (kind !== "adjust" || reason !== "");
  const save = useMutation({
    mutationFn: () => ok(api.POST("/v1/stock/movements", { body: {
      items: [{ variantId: row.variantId, kind, quantity: n!, ...(kind === "adjust" && reason ? { reason } : {}) }], ...(note.trim() ? { note: note.trim() } : {}),
    } })),
    onSuccess: (r) => {
      toast({ message: r.ordersReserved > 0 ? t("savedWithOrders", { sku: row.sku, count: r.ordersReserved }) : t("saved", { sku: row.sku }) });
      void qc.invalidateQueries({ queryKey: ["stock"] });
      void qc.invalidateQueries({ queryKey: ["orders"] });
      onClose();
    },
  });
  const below = save.error instanceof ApiError && save.error.code === "below_reserved";
  return (
    <Dialog open onClose={onClose} title={t("title", { sku: row.sku })} description={[row.productTitle, row.variantTitle].filter(Boolean).join(" · ")}
      footer={(
        <ButtonGroup>
          <Button busy={save.isPending} disabled={!valid} onClick={() => save.mutate()}>{t("save")}</Button>
          <Button variant="ghost" onClick={onClose}>{t("close")}</Button>
        </ButtonGroup>
      )}>
      <div className="flex flex-col gap-4" data-testid="stock-editor">
        {row.counted ? (
          <p className="text-body-sm text-text-2">{t.rich("now", { onHand: row.onHand!, reserved: row.reserved!, available: row.available!, b: (c) => <Bdi>{c}</Bdi> })}</p>
        ) : <p className="text-body-sm text-text-2">{t("first")}</p>}
        <Select label={t("kind")} value={kind} onChange={(e) => { setKind(e.target.value as Kind); save.reset(); }}>
          {KINDS.map((k) => <option key={k} value={k}>{t(`kinds.${k}`)}</option>)}
        </Select>
        <Field label={t(`quantity.${kind}`)} hint={t(`hint.${kind}`)} inputMode="numeric" ltr value={quantity}
          onChange={(e) => { setQuantity(e.target.value); save.reset(); }} error={quantity && n === null ? t("invalid") : below ? t("belowReserved", { reserved: row.reserved ?? 0 }) : null} />
        {kind === "adjust" ? (
          <Select label={t("reason")} value={reason} onChange={(e) => setReason(e.target.value as Reason)}>
            <option value="" disabled>{t("choose")}</option>
            {REASONS.map((r) => <option key={r} value={r}>{t(`reasons.${r}`)}</option>)}
          </Select>
        ) : null}
        <Field label={t("note")} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
        {row.counted ? <Threshold row={row} /> : null}
      </div>
    </Dialog>
  );
}

/** When to warn about this item: an alert (stock.low) fires once when available falls to it. */
function Threshold({ row }: { row: Row }) {
  const t = useTranslations("stock.threshold");
  const { api } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [value, setValue] = useState(row.lowStockAt === null ? "" : String(row.lowStockAt));
  const ascii = toAsciiDigits(value.trim());
  const n = ascii === "" ? null : /^\d{1,6}$/.test(ascii) ? Number(ascii) : undefined;
  const save = useMutation({
    mutationFn: () => ok(api.PATCH("/v1/stock/{variantId}", { params: { path: { variantId: row.variantId } }, body: { lowStockAt: n ?? null } })),
    onSuccess: () => { toast({ message: n === null ? t("cleared", { sku: row.sku }) : t("saved", { sku: row.sku, n: n ?? 0 }) }); void qc.invalidateQueries({ queryKey: ["stock"] }); },
  });
  return (
    <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3" data-testid="stock-threshold">
      <Field label={t("label")} hint={t("hint")} inputMode="numeric" ltr value={value} onChange={(e) => setValue(e.target.value)} error={n === undefined ? t("invalid") : null} className="grow" />
      <Button variant="secondary" busy={save.isPending} disabled={n === undefined || n === row.lowStockAt} onClick={() => save.mutate()}>{t("save")}</Button>
    </div>
  );
}

/** Send Mizan's count to the store (Shopify), so it never sells what's reserved or gone. */
function StoreSync() {
  const t = useTranslations("stock.sync");
  const { api, user, store } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const key = ["inventorySettings", user?.uid ?? "", store?.tenantId ?? ""];
  const q = useQuery({ queryKey: key, queryFn: () => ok(api.GET("/v1/settings/inventory")) });
  const save = useMutation({
    mutationFn: (pushToStore: boolean) => ok(api.PUT("/v1/settings/inventory", { body: { pushToStore } })),
    onSuccess: (r) => { qc.setQueryData(key, r); toast({ message: r.pushToStore ? t("on") : t("off") }); },
  });
  return (
    <div className="mz-card p-4" data-testid="stock-sync">
      <Switch label={t("label")} description={t("description")} checked={q.data?.pushToStore ?? false} disabled={!q.data || save.isPending}
        onChange={(e) => save.mutate(e.target.checked)} />
    </div>
  );
}

/** The item's last movements: every number on the screen comes from these. */
function History({ row, onClose }: { row: Row; onClose(): void }) {
  const t = useTranslations("stock.historyDialog");
  const { api, user, store } = useSession();
  const q = useQuery({
    queryKey: ["stockHistory", user?.uid ?? "", store?.tenantId ?? "", row.variantId],
    queryFn: () => ok(api.GET("/v1/stock/{variantId}/movements", { params: { path: { variantId: row.variantId } } })),
  });
  return (
    <Dialog open onClose={onClose} title={t("title", { sku: row.sku })} footer={<Button variant="ghost" onClick={onClose}>{t("close")}</Button>}>
      {q.isPending ? <SkeletonRows rows={4} label={t("loading")} /> : null}
      {q.data ? (
        <ul className="flex flex-col divide-y divide-line text-body-sm" data-testid="stock-history">
          {q.data.data.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="flex flex-col">
                <span>{t(`kind.${m.kind}`)}{m.reason ? <>{" · "}{t(`reason.${m.reason as Reason}`)}</> : null}</span>
                <span className="text-caption text-text-3">
                  <DateText value={m.at} />
                  {m.order ? <>{" · "}<Link href={`/orders/${m.order.id}`} className="hover:underline"><Bdi>{m.order.number}</Bdi></Link></> : null}
                  {m.note ? <>{" · "}{m.note}</> : null}
                </span>
              </span>
              <Bdi>{m.delta > 0 ? `+${m.delta}` : m.delta}</Bdi>
            </li>
          ))}
        </ul>
      ) : null}
    </Dialog>
  );
}

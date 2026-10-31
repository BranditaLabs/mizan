"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Bdi } from "@/components/Bdi";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Cell, DataTable, IdCell, type Column } from "@/components/ui/DataTable";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { EmptyState, SkeletonRows } from "@/components/ui/Surface";
import { Tabs } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";
import { DateText } from "@/components/ui/Values";
import { Link, useRouter } from "@/i18n/navigation";
import { ApiError, ok, type Schemas } from "@/lib/api/client";
import { problemText } from "@/lib/api/query";
import { useSession } from "@/lib/session";

type Row = Schemas["PickListPage"]["data"][number];
type Status = "open" | "closed";
const PICKERS = new Set(["owner", "admin", "ops_manager", "warehouse"]);

/**
 * Pick lists (M4, E8-4c) from the dashboard: batch the confirmed orders ready to pack, print the
 * list by shelf, and close it. Packing is by scan in the ops app, which works from the same lists.
 */
export function PickLists() {
  const t = useTranslations("pickLists");
  const tpr = useTranslations("problem");
  const { api, user, store } = useSession();
  const qc = useQueryClient();
  const router = useRouter();
  const allowed = PICKERS.has(store?.role ?? "");
  const [status, setStatus] = useState<Status>("open");
  const [size, setSize] = useState("30");
  const list = useQuery({
    queryKey: ["pickLists", user?.uid ?? "", store?.tenantId ?? "", status],
    queryFn: () => ok(api.GET("/v1/picklists", { params: { query: { status } } })),
    enabled: allowed,
  });
  const n = Number(size);
  const validSize = /^\d{1,3}$/.test(size) && n >= 1 && n <= 100;
  const create = useMutation({
    mutationFn: () => ok(api.POST("/v1/picklists", { body: { limit: n } })),
    meta: { toast: false },
    onSuccess: (p) => { void qc.invalidateQueries({ queryKey: ["pickLists"] }); router.push(`/stock/picklists/${p.id}`); },
  });
  const nothing = create.error instanceof ApiError && create.error.code === "nothing_to_pick";
  const columns: Column<Row>[] = [
    { id: "number", header: t("columns.number"), cell: (r) => <Cell main={<Link href={`/stock/picklists/${r.id}`} className="hover:underline"><IdCell>{t("number", { n: r.number })}</IdCell></Link>} sub={<DateText value={r.createdAt} relative />} /> },
    { id: "packed", header: t("columns.packed"), cell: (r) => <Badge tone={r.packed === r.orders ? "success" : "info"}>{t("packedOf", { packed: r.packed, orders: r.orders })}</Badge> },
  ];
  const frame = (body: React.ReactNode) => (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-5 px-4 pt-6 pb-14 md:px-6" data-testid="pick-lists">
      <Link href="/stock" className="text-body-sm text-text-2 underline">{t("backToStock")}</Link>
      <header>
        <h1 className="font-display text-heading-lg">{t("title")}</h1>
        <p className="mt-1 max-w-[70ch] text-body-sm text-text-2">{t("subtitle")}</p>
      </header>
      {body}
    </div>
  );
  if (!allowed) return frame(<div className="mz-card"><EmptyState icon="locked" title={t("notAllowed.title")} body={t("notAllowed.body")} /></div>);
  return frame(
    <>
      <form className="mz-card flex flex-col gap-2 p-4" onSubmit={(e) => { e.preventDefault(); if (validSize) create.mutate(); }}>
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t("size")} inputMode="numeric" ltr value={size} onChange={(e) => setSize(e.target.value)} className="w-40" />
          <Button type="submit" icon="add" busy={create.isPending} disabled={!validSize}>{t("create")}</Button>
        </div>
        <p className="text-caption text-text-2">{t("sizeHint")}</p>
      </form>
      {create.isError ? (nothing ? <Alert tone="info">{t("nothing")}</Alert> : <Alert tone="danger">{problemText(create.error, tpr)}</Alert>) : null}
      <Tabs label={t("tabsLabel")} value={status} onChange={setStatus} items={(["open", "closed"] as const).map((s) => ({ value: s, label: t(`status.${s}`) }))}>
        {list.isPending ? <div className="mz-card"><SkeletonRows rows={3} label={t("loading")} /></div>
          : list.isError ? <Alert tone="danger">{problemText(list.error, tpr)}</Alert>
          : <DataTable label={t("title")} columns={columns} rows={list.data.data} rowKey={(r) => r.id} rowLabel={(r) => t("number", { n: r.number })}
              empty={<EmptyState icon="warehouse" title={t(`empty.${status}.title`)} body={t(`empty.${status}.body`)} />} />}
      </Tabs>
    </>,
  );
}

/** One pick list: what to take from each shelf, then each order's lines to pack. Prints on paper colours. */
export function PickListDetail({ id }: { id: string }) {
  const t = useTranslations("pickLists");
  const tpr = useTranslations("problem");
  const { api, user, store } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const allowed = PICKERS.has(store?.role ?? "");
  const [closing, setClosing] = useState(false);
  const q = useQuery({
    queryKey: ["pickLists", user?.uid ?? "", store?.tenantId ?? "", "one", id],
    queryFn: () => ok(api.GET("/v1/picklists/{id}", { params: { path: { id } } })),
    enabled: allowed,
    meta: { toast: false },
  });
  const close = useMutation({
    mutationFn: () => ok(api.POST("/v1/picklists/{id}/close", { params: { path: { id } } })),
    onSuccess: () => { toast({ message: t("closed") }); setClosing(false); void qc.invalidateQueries({ queryKey: ["pickLists"] }); },
  });
  const frame = (body: React.ReactNode) => (
    <div className="mx-auto flex max-w-[960px] flex-col gap-4 px-4 pt-6 pb-14 md:px-6 print:max-w-none print:p-0" data-testid="pick-list">{body}</div>
  );
  if (!allowed) return frame(<div className="mz-card"><EmptyState icon="locked" title={t("notAllowed.title")} body={t("notAllowed.body")} /></div>);
  const p = q.data;
  if (!p) return frame(q.isError ? <Alert tone="danger">{problemText(q.error, tpr)}</Alert> : <div className="mz-card"><SkeletonRows rows={5} label={t("loading")} /></div>);
  const packed = p.orders.filter((o) => o.packedAt).length;
  return frame(
    <div data-theme="light" className="flex flex-col gap-4 rounded-lg bg-bg p-5 text-text print:rounded-none print:p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/stock/picklists" className="text-body-sm text-text-2 underline">{t("backToLists")}</Link>
        <span className="flex gap-2">
          <Button size="sm" variant="secondary" icon="print" onClick={() => window.print()}>{t("print")}</Button>
          {p.status === "open" ? <Button size="sm" variant="secondary" onClick={() => setClosing(true)}>{t("close")}</Button> : null}
        </span>
      </div>
      <header className="flex flex-col gap-1 border-b border-line pb-3">
        <h1 className="font-display text-heading-lg">{t("number", { n: p.number })}</h1>
        <p className="flex flex-wrap items-center gap-2 text-body-sm text-text-2">
          <Badge tone={p.status === "open" ? "info" : "neutral"}>{t(`status.${p.status}`)}</Badge>
          {t("packedOf", { packed, orders: p.orders.length })}
          {" · "}<DateText value={p.createdAt} />
        </p>
      </header>

      <section className="mz-card p-4">
        <h2 className="mb-2 text-heading-sm">{t("pick")}</h2>
        {p.items.length === 0 ? <p className="text-body-sm text-text-2">{t("allPacked")}</p> : (
          <table className="w-full text-body-sm" data-testid="pick-items">
            <thead className="text-caption text-text-2">
              <tr><th className="py-1 text-start font-normal">{t("bin")}</th><th className="py-1 text-start font-normal">{t("item")}</th><th className="py-1 text-end font-normal">{t("qty")}</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {p.items.map((i, k) => (
                <tr key={k}>
                  <td className="py-1.5"><bdi dir="ltr" className="mz-id">{i.bin ?? "—"}</bdi></td>
                  <td className="py-1.5"><bdi>{i.title}</bdi>{i.sku ? <span className="text-text-3"> · <bdi dir="ltr" className="mz-id">{i.sku}</bdi></span> : null}</td>
                  <td className="py-1.5 text-end"><Bdi>{i.quantity}</Bdi></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="mz-card p-4">
        <h2 className="mb-2 text-heading-sm">{t("orders")}</h2>
        <ul className="flex flex-col divide-y divide-line">
          {p.orders.map((o) => (
            <li key={o.id} className="flex flex-col gap-1 py-2 text-body-sm">
              <span className="flex flex-wrap items-center justify-between gap-2">
                <Link href={`/orders/${o.id}`} className="hover:underline"><IdCell>{o.number}</IdCell></Link>
                {o.packedAt ? <Badge tone="success">{t("packed")}</Badge> : <Badge tone="neutral" dot={false}>{t("toPack")}</Badge>}
              </span>
              <ul className="text-caption text-text-2">
                {o.lines.map((l, k) => <li key={k}><bdi>{l.title}</bdi> {t("times", { n: l.quantity })}{l.barcode ? <> · <bdi dir="ltr" className="mz-id">{l.barcode}</bdi></> : null}</li>)}
              </ul>
            </li>
          ))}
        </ul>
      </section>
      <ConfirmDialog open={closing} onClose={() => setClosing(false)} onConfirm={() => close.mutate()} busy={close.isPending}
        title={t("closeTitle", { n: p.number })} description={t("closeBody")} confirmLabel={t("close")} />
    </div>,
  );
}

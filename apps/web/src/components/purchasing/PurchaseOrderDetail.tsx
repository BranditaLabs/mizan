"use client";

import { Icon } from "@mizan/design-system/icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Badge, Tag } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Choice";
import { Cell, DataTable, IdCell, type Column } from "@/components/ui/DataTable";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Card, EmptyState, KeyValue, SkeletonRows } from "@/components/ui/Surface";
import { useToast } from "@/components/ui/Toast";
import { DateText, MoneyText } from "@/components/ui/Values";
import { Link } from "@/i18n/navigation";
import { ApiError, ok, type Schemas } from "@/lib/api/client";
import { problemText } from "@/lib/api/query";
import { useSession } from "@/lib/session";
import { MANAGERS, OWNERS, RECEIVABLE, RECEIVERS, STATUS_TONE, VIEWERS } from "./purchasing-ui";

type Po = Schemas["PurchaseOrder"];
type Line = Po["lines"][number];
const COUNT = /^\d{0,6}$/;

/**
 * One purchase order (M16-2): its lines with what arrived, its receipts (with the FX rate locked
 * at each), and the next step for whoever may take it: approve, mark sent, receive, or cancel.
 */
export function PurchaseOrderDetail({ id }: { id: string }) {
  const t = useTranslations("purchasing");
  const tpr = useTranslations("problem");
  const { api, user, store } = useSession();
  const role = store?.role ?? "";
  const key = ["purchaseOrder", user?.uid ?? "", store?.tenantId ?? "", id];
  const q = useQuery({ queryKey: key, queryFn: () => ok(api.GET("/v1/purchase-orders/{id}", { params: { path: { id } } })), enabled: Boolean(store) && VIEWERS.has(role), meta: { toast: false } });
  const [receiving, setReceiving] = useState(false);
  const frame = (body: React.ReactNode) => (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-5 px-4 pt-6 pb-14 md:px-6" data-testid="purchase-order">
      <Link href="/purchasing" className="inline-flex items-center gap-1.5 text-body-sm text-text-2 hover:text-text"><Icon name="back" size={16} />{t("back")}</Link>
      {body}
    </div>
  );
  if (!VIEWERS.has(role)) return frame(<div className="mz-card"><EmptyState icon="locked" title={t("notAllowed.title")} body={t("notAllowed.body")} /></div>);
  if (q.isPending) return frame(<div className="mz-card"><SkeletonRows rows={5} label={t("loading")} /></div>);
  if (!q.data) {
    const missing = q.error instanceof ApiError && q.error.status === 404;
    return frame(<div className="mz-card"><EmptyState icon="error" title={missing ? t("notFound") : problemText(q.error, tpr)} body="" /></div>);
  }
  const po = q.data;
  const columns: Column<Line>[] = [
    { id: "item", header: t("columns.item"), cell: (l) => <Cell main={l.title} sub={l.sku ? <bdi className="mz-id">{l.sku}</bdi> : null} /> },
    { id: "ordered", header: t("columns.ordered"), numeric: true, cell: (l) => <span className="mz-num">{l.quantity}</span> },
    { id: "received", header: t("columns.receivedQty"), numeric: true, cell: (l) => <span className="mz-num">{l.received}</span> },
    { id: "damaged", header: t("columns.damaged"), numeric: true, cell: (l) => (l.damaged ? <span className="mz-num text-danger-text">{l.damaged}</span> : <span className="mz-num text-text-3">{0}</span>) },
    { id: "unit", header: t("columns.unitCost"), numeric: true, cell: (l) => <MoneyText money={l.unitCost} /> },
  ];
  return frame(
    <>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="font-display text-heading-lg"><IdCell>{po.number}</IdCell></h1>
        <Badge tone={STATUS_TONE[po.status]}>{t(`status.${po.status}`)}</Badge>
        {po.late ? <Badge tone="danger">{t("late")}</Badge> : null}
        {po.needsOwner && po.status === "draft" ? <Tag icon="locked">{t("needsOwnerTag")}</Tag> : null}
      </header>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card title={t("details")}>
            <div className="flex flex-col gap-3">
              <KeyValue items={[
                { label: t("fields.supplier"), value: <bdi>{po.supplier.name}</bdi> },
                { label: t("columns.total"), value: <MoneyText money={po.total} /> },
                { label: t("columns.items"), value: t("itemsUnits", { items: po.items, units: po.units }) },
                { label: t("fields.expectedAt"), value: po.expectedAt ? <DateText value={po.expectedAt} /> : "—" },
                { label: t("fields.created"), value: <DateText value={po.createdAt} /> },
                ...(po.approvedAt ? [{ label: t("fields.approvedAt"), value: <DateText value={po.approvedAt} /> }] : []),
                ...(po.sentAt ? [{ label: t("fields.sentAt"), value: <DateText value={po.sentAt} /> }] : []),
                ...(po.receivedAt ? [{ label: t("fields.receivedAt"), value: <DateText value={po.receivedAt} /> }] : []),
              ]} />
              {po.notes ? <p dir="auto" className="whitespace-pre-wrap text-body-sm text-text-2">{po.notes}</p> : null}
            </div>
          </Card>
          <DataTable label={t("lines")} columns={columns} rows={po.lines} rowKey={(l) => l.id} rowLabel={(l) => l.title} empty={null} />
          <Card title={t("receipts.title")}>
            {po.receipts.length ? (
              <ul className="flex flex-col divide-y divide-line" data-testid="po-receipts">
                {po.receipts.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-body-sm">
                    <span className="font-medium">{t("receipts.number", { n: r.number })}</span>
                    <span className="text-text-2"><DateText value={r.receivedAt} /></span>
                    <span>{t("receipts.units", { units: r.units })}</span>
                    {r.damaged ? <Badge tone="danger">{t("receipts.damaged", { n: r.damaged })}</Badge> : null}
                    {r.viaApp ? <Tag icon="device">{t("receipts.viaApp")}</Tag> : null}
                    {r.overApproved ? <Tag>{t("receipts.over")}</Tag> : null}
                    <span className="ms-auto">
                      {r.costStatus === "fx_missing" ? <Badge tone="warning">{t("receipts.fxMissing")}</Badge>
                        : r.fxRate && r.fxRate !== "1" ? <span className="text-caption text-text-3">{t("receipts.rate")} <bdi className="mz-num">{r.fxRate}</bdi></span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-body-sm text-text-2">{t("receipts.none")}</p>}
          </Card>
        </div>
        <aside className="flex flex-col gap-4 lg:sticky lg:top-6">
          <NextStep po={po} role={role} onReceive={() => setReceiving(true)} />
        </aside>
      </div>
      {receiving ? <ReceiveDialog po={po} manager={MANAGERS.has(role)} onClose={() => setReceiving(false)} /> : null}
    </>,
  );
}

/** The one thing to do next, for whoever may do it. */
function NextStep({ po, role, onReceive }: { po: Po; role: string; onReceive(): void }) {
  const t = useTranslations("purchasing");
  const tpr = useTranslations("problem");
  const { api } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const act = useMutation({
    mutationFn: (a: "approve" | "send" | "cancel") => ok(
      a === "approve" ? api.POST("/v1/purchase-orders/{id}/approve", { params: { path: { id: po.id } } })
        : a === "send" ? api.POST("/v1/purchase-orders/{id}/send", { params: { path: { id: po.id } } })
        : api.POST("/v1/purchase-orders/{id}/cancel", { params: { path: { id: po.id } } }),
    ),
    meta: { toast: false },
    onSuccess: (_r, a) => { setConfirming(false); toast({ message: t(`done.${a}`) }); void qc.invalidateQueries({ queryKey: ["purchaseOrder"] }); void qc.invalidateQueries({ queryKey: ["purchaseOrders"] }); },
  });
  const manager = MANAGERS.has(role);
  const canApprove = manager && (!po.needsOwner || OWNERS.has(role));
  const error = act.isError ? (act.error instanceof ApiError && act.error.code === "needs_owner" ? t("needsOwner") : problemText(act.error, tpr)) : null;
  const cancellable = manager && (po.status === "draft" || po.status === "approved" || po.status === "sent") && po.receipts.length === 0;
  return (
    <Card title={t("next.title")}>
      <div className="flex flex-col gap-3">
        {po.status === "draft" ? (
          <>
            <p className="text-body-sm text-text-2">{po.needsOwner ? t("next.draftOwner") : t("next.draft")}</p>
            {canApprove ? <Button icon="confirm" busy={act.isPending && act.variables === "approve"} onClick={() => act.mutate("approve")}>{t("actions.approve")}</Button>
              : manager ? <Alert tone="info">{t("needsOwner")}</Alert> : null}
          </>
        ) : null}
        {po.status === "approved" ? (
          <>
            <p className="text-body-sm text-text-2">{t("next.approved")}</p>
            {manager ? <Button icon="send" variant={RECEIVERS.has(role) ? "secondary" : "primary"} busy={act.isPending && act.variables === "send"} onClick={() => act.mutate("send")}>{t("actions.send")}</Button> : null}
          </>
        ) : null}
        {RECEIVABLE.has(po.status) && po.status !== "approved" ? <p className="text-body-sm text-text-2">{t("next.receive")}</p> : null}
        {RECEIVABLE.has(po.status) && RECEIVERS.has(role) ? <Button icon="received" onClick={onReceive}>{t("actions.receive")}</Button> : null}
        {po.status === "received" ? <Alert tone="success">{t("next.received")}</Alert> : null}
        {po.status === "cancelled" ? <Alert tone="info">{t("next.cancelled")}</Alert> : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {cancellable && !confirming ? <Button variant="ghost" onClick={() => setConfirming(true)}>{t("actions.cancel")}</Button> : null}
        {cancellable && confirming ? (
          <div className="flex flex-col gap-2 rounded-md border border-line p-3">
            <p className="text-body-sm">{t("cancelConfirm", { number: po.number })}</p>
            <div className="flex gap-2">
              <Button variant="danger" size="sm" busy={act.isPending && act.variables === "cancel"} onClick={() => act.mutate("cancel")}>{t("actions.cancelYes")}</Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>{t("actions.keep")}</Button>
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

/** Take a delivery in: good and damaged units per line; more than ordered only with a manager's tick. */
function ReceiveDialog({ po, manager, onClose }: { po: Po; manager: boolean; onClose(): void }) {
  const t = useTranslations("purchasing");
  const tpr = useTranslations("problem");
  const { api } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const left = (l: Line) => Math.max(0, l.quantity - l.received - l.damaged);
  const [good, setGood] = useState<Record<string, string>>(() => Object.fromEntries(po.lines.map((l) => [l.id, String(left(l))])));
  const [damaged, setDamaged] = useState<Record<string, string>>({});
  const [allowOver, setAllowOver] = useState(false);
  const n = (v: string | undefined) => (v && COUNT.test(v) ? Number(v) : 0);
  const items = po.lines.map((l) => ({ variantId: l.variantId, quantity: n(good[l.id]), damaged: n(damaged[l.id]) })).filter((i) => i.quantity + i.damaged > 0);
  const over = po.lines.some((l) => n(good[l.id]) + n(damaged[l.id]) > left(l));
  const invalid = po.lines.some((l) => !COUNT.test(good[l.id] ?? "") || !COUNT.test(damaged[l.id] ?? ""));
  const save = useMutation({
    mutationFn: () => ok(api.POST("/v1/purchase-orders/{id}/receipts", { params: { path: { id: po.id } }, body: { items, allowOver: over && allowOver } })),
    meta: { toast: false },
    onSuccess: (r) => {
      toast({ message: r.status === "received" ? t("receive.doneAll") : t("receive.done") });
      void qc.invalidateQueries({ queryKey: ["purchaseOrder"] });
      void qc.invalidateQueries({ queryKey: ["purchaseOrders"] });
      void qc.invalidateQueries({ queryKey: ["stock"] });
      onClose();
    },
  });
  const err = save.error instanceof ApiError ? save.error : null;
  const message = err?.code === "over_receipt" ? t("receive.overError") : save.isError ? problemText(save.error, tpr) : null;
  return (
    <Dialog open onClose={onClose} title={t("receive.title", { number: po.number })} description={t("receive.description")} footer={(
      <>
        <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
        <Button busy={save.isPending} disabled={!items.length || invalid || (over && !allowOver)} onClick={() => save.mutate()}>{t("receive.save")}</Button>
      </>
    )}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (items.length && !invalid && (!over || allowOver)) save.mutate(); }}>
        <ul className="flex flex-col divide-y divide-line">
          {po.lines.map((l) => (
            <li key={l.id} className="flex flex-wrap items-end gap-3 py-2">
              <div className="min-w-36 flex-1">
                <p className="text-body-sm font-medium">{l.title}</p>
                <p className="text-caption text-text-3">{t("receive.left", { n: left(l) })}{l.sku ? <> · <bdi className="mz-id">{l.sku}</bdi></> : null}</p>
              </div>
              <Field label={t("receive.good")} ltr inputMode="numeric" className="w-24" value={good[l.id] ?? ""} onChange={(e) => setGood({ ...good, [l.id]: e.target.value.trim() })}
                error={!COUNT.test(good[l.id] ?? "") ? t("errors.count") : null} />
              <Field label={t("receive.damaged")} ltr inputMode="numeric" className="w-24" value={damaged[l.id] ?? ""} onChange={(e) => setDamaged({ ...damaged, [l.id]: e.target.value.trim() })}
                error={!COUNT.test(damaged[l.id] ?? "") ? t("errors.count") : null} />
            </li>
          ))}
        </ul>
        {over ? (manager ? <Checkbox label={t("receive.allowOver")} checked={allowOver} onChange={(e) => setAllowOver(e.target.checked)} />
          : <Alert tone="warning">{t("receive.overError")}</Alert>) : null}
        <p className="text-caption text-text-3">{t("receive.costHint")}</p>
        {message ? <Alert tone="danger">{message}</Alert> : null}
      </form>
    </Dialog>
  );
}

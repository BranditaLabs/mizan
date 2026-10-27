"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { IdCell } from "@/components/ui/DataTable";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Select, TextArea } from "@/components/ui/Field";
import { Card } from "@/components/ui/Surface";
import { useToast } from "@/components/ui/Toast";
import { DateText, MoneyText } from "@/components/ui/Values";
import { Link } from "@/i18n/navigation";
import { ApiError, ok, type Schemas } from "@/lib/api/client";
import { problemText } from "@/lib/api/query";
import { useSession } from "@/lib/session";

type Refund = Schemas["Refund"];
type Destination = Schemas["NewRefund"]["destination"];
const READERS = new Set(["owner", "admin", "ops_manager", "finance"]);
const TONE: Record<Refund["status"], BadgeTone> = { requested: "warning", approved: "info", completed: "success", rejected: "neutral", failed: "danger" };
const KNOWN = new Set(["over_refund", "own_refund", "destination_unavailable", "completes_from_store", "refund_not_pending", "refund_not_approved"]);

function useRefresh() {
  const qc = useQueryClient();
  return () => {
    for (const k of ["refunds", "ledger", "order", "orderPnl", "payments", "ticket"]) void qc.invalidateQueries({ queryKey: [k] });
  };
}

/** A refund's error, in the team's words when it is one the rules raise. */
function useRefundError() {
  const t = useTranslations("refunds");
  const tpr = useTranslations("problem");
  return (e: unknown) => (e instanceof ApiError && KNOWN.has(e.code) ? t(`errors.${e.code as "over_refund"}`) : problemText(e, tpr));
}

/** One refund with what the caller may do with it now (approve, reject, record it sent). */
export function RefundRow({ refund, showOrder = false }: { refund: Refund; showOrder?: boolean }) {
  const t = useTranslations("refunds");
  const { api } = useSession();
  const toast = useToast();
  const refresh = useRefresh();
  const errorText = useRefundError();
  const [dialog, setDialog] = useState<"reject" | "complete" | null>(null);
  const approve = useMutation({
    mutationFn: () => ok(api.POST("/v1/refunds/{refundId}/approve", { params: { path: { refundId: refund.id } } })),
    meta: { toast: false },
    onSuccess: (r) => { toast({ message: t(r.status === "completed" ? "toast.completed" : "toast.approved", { number: r.number }) }); refresh(); },
  });
  return (
    <li className="flex flex-col gap-2 py-3" data-testid="refund">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="flex flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <IdCell>{refund.number}</IdCell>
            <Badge tone={TONE[refund.status]}>{t(`status.${refund.status}`)}</Badge>
            <span className="text-body-sm text-text-2">{t(`destination.${refund.destination}`)}</span>
          </span>
          <span className="text-caption text-text-3">
            {showOrder ? <><Link href={`/orders/${refund.order.id}`} className="hover:underline"><IdCell>{refund.order.number}</IdCell></Link>{" · "}</> : null}
            {refund.ticket ? <><Link href={`/tickets/${refund.ticket.id}`} className="hover:underline"><IdCell>{refund.ticket.number}</IdCell></Link>{" · "}</> : null}
            {refund.requestedBy?.name ? <><bdi>{refund.requestedBy.name}</bdi>{" · "}</> : null}
            <DateText value={refund.createdAt} />
          </span>
          {refund.reason ? <span dir="auto" className="text-body-sm">{refund.reason}</span> : null}
          {refund.rejectionReason ? <span dir="auto" className="text-body-sm text-text-2">{t("rejectedBecause", { reason: refund.rejectionReason })}</span> : null}
          {refund.reference ? <span className="text-caption text-text-3">{t("reference")}{" "}<bdi className="mz-id">{refund.reference}</bdi></span> : null}
        </span>
        <MoneyText money={refund.amount} />
      </div>
      {refund.status === "requested" && !refund.can.approve && refund.needsApproval ? <p className="text-caption text-text-2">{t("waitsForApproval")}</p> : null}
      {refund.status === "approved" && refund.completesFromStore ? <p className="text-caption text-text-2">{t("fromStore")}</p> : null}
      {approve.isError ? <Alert tone="danger">{errorText(approve.error)}</Alert> : null}
      {refund.can.approve || refund.can.reject || refund.can.complete ? (
        <div className="flex flex-wrap gap-2">
          {refund.can.approve ? <Button size="sm" busy={approve.isPending} onClick={() => approve.mutate()}>{t("approve")}</Button> : null}
          {refund.can.reject ? <Button size="sm" variant="ghost" onClick={() => setDialog("reject")}>{t("reject")}</Button> : null}
          {refund.can.complete ? <Button size="sm" variant="secondary" onClick={() => setDialog("complete")}>{t("markSent")}</Button> : null}
        </div>
      ) : null}
      {dialog ? <RefundStep refund={refund} step={dialog} onClose={() => setDialog(null)} /> : null}
    </li>
  );
}

function RefundStep({ refund, step, onClose }: { refund: Refund; step: "reject" | "complete"; onClose(): void }) {
  const t = useTranslations("refunds");
  const { api } = useSession();
  const toast = useToast();
  const refresh = useRefresh();
  const errorText = useRefundError();
  const [text, setText] = useState("");
  const save = useMutation({
    mutationFn: () => (step === "reject"
      ? ok(api.POST("/v1/refunds/{refundId}/reject", { params: { path: { refundId: refund.id } }, body: { reason: text.trim() } }))
      : ok(api.POST("/v1/refunds/{refundId}/complete", { params: { path: { refundId: refund.id } }, body: text.trim() ? { reference: text.trim() } : {} }))),
    meta: { toast: false },
    onSuccess: (r) => { toast({ message: t(step === "reject" ? "toast.rejected" : "toast.completed", { number: r.number }) }); refresh(); onClose(); },
  });
  const ready = step === "complete" || text.trim().length > 0;
  return (
    <Dialog open onClose={onClose} title={t(step === "reject" ? "rejectTitle" : "sentTitle", { number: refund.number })} footer={(
      <>
        <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
        <Button busy={save.isPending} disabled={!ready} onClick={() => save.mutate()}>{t(step === "reject" ? "reject" : "markSent")}</Button>
      </>
    )}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (ready) save.mutate(); }}>
        {step === "reject"
          ? <TextArea label={t("rejectReason")} maxLength={300} rows={2} value={text} onChange={(e) => setText(e.target.value)} />
          : <Field label={t("referenceLabel")} hint={t("referenceHint")} ltr maxLength={100} value={text} onChange={(e) => setText(e.target.value)} />}
        {save.isError ? <Alert tone="danger">{errorText(save.error)}</Alert> : null}
      </form>
    </Dialog>
  );
}

function RequestRefund({ orderId, onClose }: { orderId: string; onClose(): void }) {
  const t = useTranslations("refunds");
  const { api, user, store } = useSession();
  const toast = useToast();
  const refresh = useRefresh();
  const errorText = useRefundError();
  const opts = useQuery({
    queryKey: ["refunds", user?.uid ?? "", store?.tenantId ?? "", "options", orderId],
    queryFn: () => ok(api.GET("/v1/orders/{id}/refunds/options", { params: { path: { id: orderId } } })),
  });
  const [amount, setAmount] = useState<string | null>(null);
  const [destination, setDestination] = useState<Destination | "">("");
  const [reason, setReason] = useState("");
  const o = opts.data;
  const value = amount ?? (o && Number(o.refundable.amount) > 0 ? o.refundable.amount : "");
  const dest = destination || (o?.destinations[0] ?? "");
  const save = useMutation({
    mutationFn: () => ok(api.POST("/v1/orders/{id}/refunds", { params: { path: { id: orderId } }, body: { amount: value.trim(), destination: dest as Destination, ...(reason.trim() ? { reason: reason.trim() } : {}) } })),
    meta: { toast: false },
    onSuccess: (r) => { toast({ message: t(`toast.${r.status === "requested" ? "requested" : r.status === "completed" ? "completed" : "approved"}`, { number: r.number }) }); refresh(); onClose(); },
  });
  const nothing = o && Number(o.refundable.amount) === 0;
  return (
    <Dialog open onClose={onClose} title={t("requestTitle")} footer={(
      <>
        <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
        <Button busy={save.isPending} disabled={!o || nothing || !value.trim() || !dest} onClick={() => save.mutate()}>{t("request")}</Button>
      </>
    )}>
      {!o ? <p className="text-body-sm text-text-3">{t("loading")}</p> : (
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (!nothing && value.trim() && dest) save.mutate(); }}>
          {nothing ? <Alert tone="info">{t("nothingToRefund")}</Alert> : null}
          <Field label={t("amount", { currency: o.refundable.currency })} inputMode="decimal" ltr value={value} onChange={(e) => setAmount(e.target.value)}
            hint={t.rich("refundable", { amount: o.refundable.amount, n: (c) => <bdi dir="ltr" className="mz-num">{c}</bdi> })} />
          <Select label={t("destinationLabel")} value={dest} onChange={(e) => setDestination(e.target.value as Destination)}>
            {o.destinations.map((d) => <option key={d} value={d}>{t(`destination.${d}`)}</option>)}
          </Select>
          <TextArea label={t("reasonLabel")} maxLength={300} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          <p className="text-caption text-text-3">{t.rich("threshold", { amount: o.approveOver.amount, currency: o.approveOver.currency, n: (c) => <bdi dir="ltr" className="mz-num">{c}</bdi> })}</p>
          {save.isError ? <Alert tone="danger">{errorText(save.error)}</Alert> : null}
        </form>
      )}
    </Dialog>
  );
}

/** The order's refunds (E14-4) and a button to ask for one. */
export function RefundsCard({ orderId }: { orderId: string }) {
  const t = useTranslations("refunds");
  const { api, user, store } = useSession();
  const allowed = READERS.has(store?.role ?? "");
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["refunds", user?.uid ?? "", store?.tenantId ?? "", "order", orderId],
    queryFn: () => ok(api.GET("/v1/refunds", { params: { query: { orderId, status: "all", limit: 50 } } })),
    enabled: allowed,
    meta: { toast: false },
  });
  if (!allowed) return null;
  return (
    <Card title={t("title")} actions={<Button size="sm" variant="secondary" icon="add" onClick={() => setOpen(true)}>{t("request")}</Button>}>
      <div data-testid="order-refunds">
        {q.data && q.data.data.length === 0 ? <p className="text-body-sm text-text-2">{t("none")}</p> : null}
        <ul className="flex flex-col divide-y divide-line">{(q.data?.data ?? []).map((r) => <RefundRow key={r.id} refund={r} />)}</ul>
      </div>
      {open ? <RequestRefund orderId={orderId} onClose={() => setOpen(false)} /> : null}
    </Card>
  );
}

/** Refunds still to handle across the store (approve, reject, send), for the payments screen. */
export function RefundQueue() {
  const t = useTranslations("refunds");
  const { api, user, store } = useSession();
  const q = useQuery({
    queryKey: ["refunds", user?.uid ?? "", store?.tenantId ?? "", "open"],
    queryFn: () => ok(api.GET("/v1/refunds", { params: { query: { status: "open", limit: 50 } } })),
    enabled: READERS.has(store?.role ?? ""),
    meta: { toast: false },
  });
  const rows = q.data?.data ?? [];
  if (!rows.length) return null;
  return (
    <Card title={t("queueTitle", { count: rows.length })}>
      <ul className="flex flex-col divide-y divide-line" data-testid="refund-queue">{rows.map((r) => <RefundRow key={r.id} refund={r} showOrder />)}</ul>
    </Card>
  );
}

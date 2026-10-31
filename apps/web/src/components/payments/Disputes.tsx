"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Badge, Tag, type BadgeTone } from "@/components/ui/Badge";
import { Button, buttonClass } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Choice";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Select, TextArea } from "@/components/ui/Field";
import { Card } from "@/components/ui/Surface";
import { useToast } from "@/components/ui/Toast";
import { DateText, MoneyText } from "@/components/ui/Values";
import { Link } from "@/i18n/navigation";
import { ApiError, ok, type Schemas } from "@/lib/api/client";
import { problemText } from "@/lib/api/query";
import { useSession } from "@/lib/session";

type Dispute = Schemas["Dispute"];
type Reason = Schemas["NewDispute"]["reason"];
const READERS = new Set(["owner", "admin", "ops_manager", "finance"]);
export const DISPUTE_MANAGERS = new Set(["owner", "admin", "finance"]);
const REASONS: Reason[] = ["fraud", "not_received", "not_as_described", "duplicate", "cancelled", "other"];
const TONE: Record<Dispute["status"], BadgeTone> = { open: "warning", evidence_submitted: "info", won: "success", lost: "danger", accepted: "neutral" };
const isOpen = (d: Dispute) => d.status === "open" || d.status === "evidence_submitted";

function useRefresh() {
  const qc = useQueryClient();
  return () => { for (const k of ["disputes", "ledger", "order", "orderPnl", "payments"]) void qc.invalidateQueries({ queryKey: [k] }); };
}

/**
 * Chargebacks on an order (E14-5): record one the gateway or bank reported, answer it with the
 * evidence pack before its deadline, and close it. Shown when the order has a dispute or money
 * the store holds; owner, admin and finance act, the ops manager reads.
 */
export function DisputesCard({ orderId }: { orderId: string }) {
  const t = useTranslations("disputes");
  const { api, user, store } = useSession();
  const role = store?.role ?? "";
  const scope = [user?.uid ?? "", store?.tenantId ?? ""];
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["disputes", ...scope, "order", orderId],
    queryFn: () => ok(api.GET("/v1/disputes", { params: { query: { orderId, status: "all" } } })),
    enabled: READERS.has(role),
    meta: { toast: false },
  });
  const ledger = useQuery({
    queryKey: ["ledger", ...scope, orderId],
    queryFn: () => ok(api.GET("/v1/orders/{id}/payments", { params: { path: { id: orderId } } })),
    enabled: READERS.has(role),
    meta: { toast: false },
  });
  const rows = q.data?.data ?? [];
  const held = ledger.data && Number(ledger.data.net.amount) > 0 ? ledger.data.net : null;
  const canRecord = DISPUTE_MANAGERS.has(role) && held !== null;
  if (!READERS.has(role) || (!rows.length && !canRecord)) return null;
  return (
    <Card title={t("title")} actions={canRecord ? <Button size="sm" variant="secondary" icon="add" onClick={() => setOpen(true)}>{t("record")}</Button> : null}>
      <div data-testid="order-disputes">
        {rows.length ? <ul className="flex flex-col divide-y divide-line">{rows.map((d) => <DisputeRow key={d.id} dispute={d} />)}</ul>
          : <p className="text-body-sm text-text-2">{t("none")}</p>}
      </div>
      {open && held ? <RecordDispute orderId={orderId} held={held} onClose={() => setOpen(false)} /> : null}
    </Card>
  );
}

/** Disputes still open across the store, nearest deadline first, for the payments screen. */
export function DisputeQueue() {
  const t = useTranslations("disputes");
  const { api, user, store } = useSession();
  const q = useQuery({
    queryKey: ["disputes", user?.uid ?? "", store?.tenantId ?? "", "open"],
    queryFn: () => ok(api.GET("/v1/disputes", { params: { query: { status: "open" } } })),
    enabled: READERS.has(store?.role ?? ""),
    meta: { toast: false },
  });
  const rows = q.data?.data ?? [];
  if (!rows.length) return null;
  return (
    <Card title={t("queueTitle", { count: rows.length })}>
      <ul className="flex flex-col divide-y divide-line" data-testid="dispute-queue">{rows.map((d) => <DisputeRow key={d.id} dispute={d} showOrder />)}</ul>
    </Card>
  );
}

function Deadline({ d }: { d: Dispute }) {
  const t = useTranslations("disputes");
  if (!isOpen(d) || d.daysLeft === null || !d.respondBy) return null;
  const tone = d.daysLeft < 0 ? "text-danger-text" : d.daysLeft <= 3 ? "text-warning-text" : "text-text-3";
  return (
    <span className={`text-caption ${tone}`}>
      {d.daysLeft < 0 ? t("missed") : t("daysLeft", { days: d.daysLeft })} · <DateText value={d.respondBy} />
    </span>
  );
}

function DisputeRow({ dispute: d, showOrder = false }: { dispute: Dispute; showOrder?: boolean }) {
  const t = useTranslations("disputes");
  const { store } = useSession();
  const manager = DISPUTE_MANAGERS.has(store?.role ?? "");
  const [dialog, setDialog] = useState<"evidence" | "close" | null>(null);
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <bdi className="mz-id font-medium">{d.number}</bdi>
            <Badge tone={TONE[d.status]}>{t(`status.${d.status}`)}</Badge>
            {showOrder ? <Link href={`/orders/${d.order.id}`} className="text-body-sm underline"><bdi className="mz-id">{d.order.number}</bdi></Link> : null}
          </span>
          <span className="text-caption text-text-2">
            {d.reason ? t(`reason.${d.reason}`) : null}
            {d.externalRef ? <> · <bdi className="mz-id">{d.externalRef}</bdi></> : null}
          </span>
          <Deadline d={d} />
          {d.evidenceNote ? <span dir="auto" className="text-caption text-text-2">{t("evidenceSent")}: {d.evidenceNote}</span> : null}
        </span>
        <span className="flex flex-col items-end gap-0.5">
          <MoneyText money={d.amount} />
          {Number(d.fee.amount) > 0 ? <span className="text-caption text-text-3">{t("feeShort")} <MoneyText money={d.fee} /></span> : null}
        </span>
      </div>
      {manager ? (
        <div className="flex flex-wrap gap-2">
          <Link href={`/disputes/${d.id}`} className={buttonClass("secondary", "sm")}>{t("pack")}</Link>
          {d.status === "open" ? <Button size="sm" variant="secondary" onClick={() => setDialog("evidence")}>{t("markSent")}</Button> : null}
          {isOpen(d) ? <Button size="sm" variant="ghost" onClick={() => setDialog("close")}>{t("close")}</Button> : null}
        </div>
      ) : null}
      {dialog === "evidence" ? <SubmitEvidence dispute={d} onClose={() => setDialog(null)} /> : null}
      {dialog === "close" ? <CloseDispute dispute={d} onClose={() => setDialog(null)} /> : null}
    </li>
  );
}

function RecordDispute({ orderId, held, onClose }: { orderId: string; held: { amount: string; currency: string }; onClose(): void }) {
  const t = useTranslations("disputes");
  const tpr = useTranslations("problem");
  const { api } = useSession();
  const refresh = useRefresh();
  const toast = useToast();
  const [amount, setAmount] = useState(held.amount);
  const [fee, setFee] = useState("");
  const [reason, setReason] = useState<Reason>("fraud");
  const [respondBy, setRespondBy] = useState("");
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");
  const save = useMutation({
    mutationFn: () => ok(api.POST("/v1/orders/{id}/disputes", { params: { path: { id: orderId } }, body: {
      amount: amount.trim(), reason, ...(fee.trim() ? { fee: fee.trim() } : {}), ...(ref.trim() ? { externalRef: ref.trim() } : {}), ...(note.trim() ? { note: note.trim() } : {}),
      // The gateway's deadline is a day: the end of it, here.
      ...(respondBy ? { respondBy: new Date(`${respondBy}T23:59:00`).toISOString() } : {}),
    } })),
    meta: { toast: false },
    onSuccess: (d) => { toast({ message: t("recorded", { number: d.number }) }); refresh(); onClose(); },
  });
  const err = save.error instanceof ApiError ? save.error : null;
  const message = err?.code === "over_chargeback" ? t("errors.overChargeback") : err?.code === "case_on_other_order" ? t("errors.otherOrder")
    : err?.status === 422 ? t("errors.amount") : save.isError ? problemText(save.error, tpr) : null;
  return (
    <Dialog open onClose={onClose} title={t("recordTitle")} description={t("recordHint")} footer={(
      <>
        <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
        <Button busy={save.isPending} disabled={!amount.trim()} onClick={() => save.mutate()}>{t("save")}</Button>
      </>
    )}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (amount.trim()) save.mutate(); }}>
        <Field label={t("amount", { currency: held.currency })} hint={t.rich("held", { amount: () => <MoneyText money={held} /> })} ltr inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Field label={t("fee", { currency: held.currency })} hint={t("feeHint")} ltr inputMode="decimal" value={fee} placeholder="0" onChange={(e) => setFee(e.target.value)} />
        <Select label={t("reasonLabel")} value={reason} onChange={(e) => setReason(e.target.value as Reason)}>
          {REASONS.map((r) => <option key={r} value={r}>{t(`reason.${r}`)}</option>)}
        </Select>
        <Field label={t("respondBy")} type="date" ltr value={respondBy} onChange={(e) => setRespondBy(e.target.value)} />
        <Field label={t("caseId")} hint={t("caseHint")} ltr maxLength={100} value={ref} onChange={(e) => setRef(e.target.value)} />
        <TextArea label={t("note")} maxLength={500} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        {message ? <Alert tone="danger">{message}</Alert> : null}
      </form>
    </Dialog>
  );
}

function SubmitEvidence({ dispute, onClose }: { dispute: Dispute; onClose(): void }) {
  const t = useTranslations("disputes");
  const tpr = useTranslations("problem");
  const { api } = useSession();
  const refresh = useRefresh();
  const toast = useToast();
  const [note, setNote] = useState("");
  const save = useMutation({
    mutationFn: () => ok(api.POST("/v1/disputes/{disputeId}/evidence", { params: { path: { disputeId: dispute.id } }, body: note.trim() ? { note: note.trim() } : {} })),
    meta: { toast: false },
    onSuccess: () => { toast({ message: t("sent") }); refresh(); onClose(); },
  });
  return (
    <Dialog open onClose={onClose} title={t("sentTitle", { number: dispute.number })} footer={(
      <>
        <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
        <Button busy={save.isPending} onClick={() => save.mutate()}>{t("markSent")}</Button>
      </>
    )}>
      <div className="flex flex-col gap-3">
        <TextArea label={t("sentNote")} hint={t("sentNoteHint")} maxLength={1000} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        {save.isError ? <Alert tone="danger">{problemText(save.error, tpr)}</Alert> : null}
      </div>
    </Dialog>
  );
}

function CloseDispute({ dispute, onClose }: { dispute: Dispute; onClose(): void }) {
  const t = useTranslations("disputes");
  const tpr = useTranslations("problem");
  const { api } = useSession();
  const refresh = useRefresh();
  const toast = useToast();
  const [outcome, setOutcome] = useState<"won" | "lost" | "accepted">("won");
  const [note, setNote] = useState("");
  const save = useMutation({
    mutationFn: () => ok(api.POST("/v1/disputes/{disputeId}/close", { params: { path: { disputeId: dispute.id } }, body: { outcome, ...(note.trim() ? { note: note.trim() } : {}) } })),
    meta: { toast: false },
    onSuccess: (d) => { toast({ message: t(`closed.${d.status as "won"}`) }); refresh(); onClose(); },
  });
  return (
    <Dialog open onClose={onClose} title={t("closeTitle", { number: dispute.number })} footer={(
      <>
        <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
        <Button busy={save.isPending} onClick={() => save.mutate()}>{t("close")}</Button>
      </>
    )}>
      <div className="flex flex-col gap-3">
        <Segmented label={t("outcome")} value={outcome} onChange={setOutcome}
          options={[{ value: "won", label: t("status.won") }, { value: "lost", label: t("status.lost") }, { value: "accepted", label: t("status.accepted") }]} />
        <p className="text-caption text-text-2">{t(`outcomeHint.${outcome}`)}</p>
        <TextArea label={t("note")} maxLength={500} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        {save.isError ? <Alert tone="danger">{problemText(save.error, tpr)}</Alert> : null}
      </div>
    </Dialog>
  );
}

/**
 * The evidence pack (E14-5), laid out to print or save as PDF for the gateway: the order, who it
 * went to and where, the courier's events, the WhatsApp exchange and the payments. Always on
 * paper colours. Opening it decrypts the customer's name and address (audited by the API).
 */
export function EvidencePack({ disputeId }: { disputeId: string }) {
  const t = useTranslations("disputes");
  const to = useTranslations("orders");
  const ts = useTranslations("shipping");
  const tpr = useTranslations("problem");
  const { api, user, store } = useSession();
  const allowed = DISPUTE_MANAGERS.has(store?.role ?? "");
  const q = useQuery({
    queryKey: ["disputes", user?.uid ?? "", store?.tenantId ?? "", "evidence", disputeId],
    queryFn: () => ok(api.GET("/v1/disputes/{disputeId}/evidence", { params: { path: { disputeId } } })),
    enabled: allowed,
    meta: { toast: false },
  });
  const p = q.data;
  const frame = (body: React.ReactNode) => (
    <div className="mx-auto flex max-w-[860px] flex-col gap-4 px-4 pt-6 pb-14 md:px-6 print:max-w-none print:p-0" data-testid="evidence-pack">{body}</div>
  );
  if (!allowed) return frame(OPS_VIEWERS.has(store?.role ?? "") ? <DisputeSummary disputeId={disputeId} /> : <Alert tone="info">{t("notAllowed")}</Alert>);
  if (!p) return frame(<p className="text-body-sm text-text-3">{q.isError ? problemText(q.error, tpr) : t("loading")}</p>);
  const d = p.dispute;
  const orderStatus = (s: string) => (s in STATUS_KEYS ? to(`status.${s as "new"}`) : s);
  const shipStatus = (s: string) => (SHIP_KEYS.has(s) ? ts(`status.${s as "delivered"}`) : s);
  const kind = (k: string) => (KIND_KEYS.has(k) ? to(`detail.kind.${k as "sale"}`) : k);
  const method = (m: string) => (METHOD_KEYS.has(m) ? to(`detail.method.${m as "cod"}`) : m);
  const row = (label: React.ReactNode, value: React.ReactNode) => (
    <div className="grid grid-cols-[10rem_minmax(0,1fr)] gap-3 py-1 text-body-sm"><dt className="text-text-2">{label}</dt><dd>{value}</dd></div>
  );
  return frame(
    <div data-theme="light" className="flex flex-col gap-4 rounded-lg bg-bg p-5 text-text print:rounded-none print:p-0">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <Link href={`/orders/${d.order.id}`} className="text-body-sm text-text-2 underline">{t("backToOrder")}</Link>
        <Button size="sm" icon="print" onClick={() => window.print()}>{t("print")}</Button>
      </div>
      <header className="flex flex-col gap-1 border-b border-line pb-3">
        <p className="text-caption text-text-2"><bdi>{p.store.name}</bdi> · {t("generated")} <DateText value={p.generatedAt} /></p>
        <h1 className="font-display text-heading-lg">{t("packTitle", { number: d.number })}</h1>
        <p className="text-body-sm">
          {t("packFor")} <bdi className="mz-id">{p.order.number}</bdi> · <MoneyText money={d.amount} />
          {d.reason ? <> · {t(`reason.${d.reason}`)}</> : null}
          {d.externalRef ? <> · <bdi className="mz-id">{d.externalRef}</bdi></> : null}
        </p>
        {d.respondBy ? <p className="text-caption text-text-2">{t("respondBy")}: <DateText value={d.respondBy} /></p> : null}
      </header>

      <section className="mz-card p-4">
        <h2 className="mb-2 text-heading-sm">{t("sections.order")}</h2>
        <dl>
          {row(t("fields.placed"), <DateText value={p.order.placedAt} />)}
          {row(t("fields.status"), orderStatus(p.order.status))}
          {p.order.confirmedAt ? row(t("fields.confirmed"), <DateText value={p.order.confirmedAt} />) : null}
          {p.order.shippedAt ? row(t("fields.shipped"), <DateText value={p.order.shippedAt} />) : null}
          {p.order.deliveredAt ? row(t("fields.delivered"), <DateText value={p.order.deliveredAt} />) : null}
          {row(t("fields.total"), <MoneyText money={p.order.total} />)}
        </dl>
        <ul className="mt-3 flex flex-col divide-y divide-line border-t border-line">
          {p.order.lines.map((l, i) => (
            <li key={i} className="flex justify-between gap-3 py-2 text-body-sm">
              <span><bdi>{l.title}</bdi>{l.sku ? <span className="text-text-3"> · <bdi className="mz-id">{l.sku}</bdi></span> : null} {t("times", { n: l.quantity })}</span>
              <MoneyText money={l.total} />
            </li>
          ))}
        </ul>
      </section>

      <section className="mz-card p-4">
        <h2 className="mb-2 text-heading-sm">{t("sections.customer")}</h2>
        {p.customer ? (
          <dl>
            {row(t("fields.name"), <bdi>{p.customer.name ?? "—"}</bdi>)}
            {row(t("fields.phone"), p.customer.phoneLast4 ? t.rich("phoneEnds", { last4: p.customer.phoneLast4, n: (c) => <bdi dir="ltr" className="mz-num">{c}</bdi> }) : "—")}
            {row(t("fields.address"), <bdi>{[p.customer.address.line1, p.customer.address.line2, p.customer.address.city, p.customer.address.province, p.customer.address.country].filter(Boolean).join(", ")}</bdi>)}
          </dl>
        ) : <p className="text-body-sm text-text-2">{t("redacted")}</p>}
      </section>

      <section className="mz-card p-4">
        <h2 className="mb-2 text-heading-sm">{t("sections.delivery")}</h2>
        {p.shipments.length === 0 ? <p className="text-body-sm text-text-2">{t("noShipment")}</p> : p.shipments.map((s, i) => (
          <div key={i} className="flex flex-col gap-1">
            <p className="text-body-sm"><bdi>{s.courier}</bdi>{s.trackingNumber ? <> · <bdi className="mz-id">{s.trackingNumber}</bdi></> : null} · {shipStatus(s.status)}</p>
            {s.trackingUrl ? <p className="text-caption"><bdi dir="ltr" className="break-all">{s.trackingUrl}</bdi></p> : null}
            <ol className="mt-1 flex flex-col gap-0.5 text-caption text-text-2">
              {s.events.map((e, j) => <li key={j}><DateText value={e.at} /> · {shipStatus(e.status)}</li>)}
            </ol>
          </div>
        ))}
      </section>

      <section className="mz-card p-4">
        <h2 className="mb-2 text-heading-sm">{t("sections.chat")}</h2>
        {p.confirmation.length === 0 && p.messages.length === 0 ? <p className="text-body-sm text-text-2">{t("noChat")}</p> : (
          <ol className="flex flex-col gap-0.5 text-caption text-text-2">
            {p.confirmation.map((c, i) => (
              <li key={`c${i}`}><DateText value={c.startedAt} /> · {t("confirmationRun")}{c.outcome ? ` · ${CHAT_OUTCOMES.has(c.outcome) ? t(`outcomes.${c.outcome as "confirmed"}`) : c.outcome}` : ""}{c.channel ? ` · ${CHANNELS.has(c.channel) ? t(`channels.${c.channel as "whatsapp"}`) : c.channel}` : ""}</li>
            ))}
            {p.messages.map((m, i) => (
              <li key={`m${i}`}><DateText value={m.at} /> · {t(m.direction === "in" ? "fromCustomer" : "toCustomer")} · {m.action && ACTIONS.has(m.action) ? t(`actions.${m.action as "confirm"}`) : <bdi>{m.action ?? m.kind}</bdi>} · {MSG_STATUS.has(m.status) ? t(`messageStatus.${m.status as "read"}`) : m.status}</li>
            ))}
          </ol>
        )}
      </section>

      <section className="mz-card p-4">
        <h2 className="mb-2 text-heading-sm">{t("sections.payments")}</h2>
        <ul className="flex flex-col divide-y divide-line">
          {p.payments.map((x, i) => (
            <li key={i} className="flex justify-between gap-3 py-1.5 text-body-sm">
              <span>{kind(x.kind)} · {method(x.method)} · <DateText value={x.at} />{x.status === "succeeded" ? null : <> · <Tag>{x.status}</Tag></>}</span>
              <MoneyText money={x.amount} />
            </li>
          ))}
        </ul>
      </section>
      <p className="text-caption text-text-3">{t("footer")}</p>
    </div>,
  );
}

const STATUS_KEYS = { new: 1, pending_confirmation: 1, confirmed: 1, shipped: 1, delivered: 1, cancelled: 1, returned: 1 };
const SHIP_KEYS = new Set(["created", "pickup_requested", "picked_up", "in_transit", "out_for_delivery", "failed_attempt", "delivered", "returning", "returned", "cancelled", "lost", "unknown"]);
const KIND_KEYS = new Set(["authorization", "capture", "sale", "cod_collection", "refund", "chargeback", "chargeback_reversal", "void"]);
const METHOD_KEYS = new Set(["cod", "card", "wallet", "apple_pay", "bnpl", "bank_transfer", "instapay", "fawry_ref", "store_credit", "cash_pos", "marketplace"]);
const CHAT_OUTCOMES = new Set(["confirmed", "changed", "cancelled", "wrong_number", "no_reply"]);
const CHANNELS = new Set(["whatsapp", "call_team", "call_auto", "voice", "agent", "link"]);
const ACTIONS = new Set(["confirm", "change", "cancel", "keep", "reason", "note"]);
const MSG_STATUS = new Set(["accepted", "sent", "delivered", "read", "failed", "received"]);

/** Ops managers follow disputes but don't open evidence (it decrypts the customer's address). */
const OPS_VIEWERS = new Set(["ops_manager"]);

/** The dispute without its evidence: where it stands and by when, for those who follow it. */
function DisputeSummary({ disputeId }: { disputeId: string }) {
  const t = useTranslations("disputes");
  const tpr = useTranslations("problem");
  const { api, user, store } = useSession();
  const q = useQuery({
    queryKey: ["disputes", user?.uid ?? "", store?.tenantId ?? "", "one", disputeId],
    queryFn: () => ok(api.GET("/v1/disputes/{disputeId}", { params: { path: { disputeId } } })),
    meta: { toast: false },
  });
  const d = q.data;
  if (!d) return <p className="text-body-sm text-text-3">{q.isError ? problemText(q.error, tpr) : t("loading")}</p>;
  return (
    <div className="flex flex-col gap-4" data-testid="dispute-summary">
      <Link href={`/orders/${d.order.id}`} className="text-body-sm text-text-2 underline">{t("backToOrder")}</Link>
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-heading-lg">{t("packTitle", { number: d.number })}</h1>
        <p className="flex flex-wrap items-center gap-2 text-body-sm">
          <Badge tone={TONE[d.status]}>{t(`status.${d.status}`)}</Badge>
          {t("packFor")} <bdi className="mz-id">{d.order.number}</bdi> · <MoneyText money={d.amount} />
          {d.reason ? <> · {t(`reason.${d.reason}`)}</> : null}
        </p>
        {d.respondBy ? <p className="text-caption text-text-2">{t("respondBy")}: <DateText value={d.respondBy} /></p> : null}
      </header>
      <Alert tone="info">{t("notAllowed")}</Alert>
    </div>
  );
}

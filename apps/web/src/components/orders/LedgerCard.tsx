"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Tag } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Choice";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Select, TextArea } from "@/components/ui/Field";
import { Card, KeyValue } from "@/components/ui/Surface";
import { useToast } from "@/components/ui/Toast";
import { DateText, MoneyText } from "@/components/ui/Values";
import { ApiError, ok, type Schemas } from "@/lib/api/client";
import { problemText } from "@/lib/api/query";
import { useSession } from "@/lib/session";

type Ledger = Schemas["Ledger"];
type Body = Schemas["RecordPayment"];
const READERS = new Set(["owner", "admin", "ops_manager", "finance"]);
const KINDS = new Set(["authorization", "capture", "sale", "cod_collection", "refund", "chargeback", "chargeback_reversal", "void"]);
const METHODS = new Set(["cod", "card", "wallet", "apple_pay", "bnpl", "bank_transfer", "instapay", "fawry_ref", "store_credit", "cash_pos", "marketplace"]);
const MANUAL: Body["method"][] = ["bank_transfer", "instapay", "wallet", "cash_pos", "store_credit"];
const REFUSALS = new Set(["over_payment", "over_refund"]);
const isZero = (m: { amount: string }) => Number(m.amount) === 0;

/**
 * The order's payment ledger (M15, E14-1): every money movement, where it came from (the store,
 * a gateway, the courier, the team), and the totals they add up to. Owner, admin and finance
 * record money that moved outside any gateway: a transfer, InstaPay, cash, or money given back.
 * Roles without the ledger see the order's own list (`fallback`).
 */
export function LedgerCard({ orderId, fallback }: { orderId: string; fallback: React.ReactNode }) {
  const t = useTranslations("orders.ledger");
  const td = useTranslations("orders.detail");
  const tpr = useTranslations("problem");
  const { api, user, store } = useSession();
  const allowed = READERS.has(store?.role ?? "");
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["ledger", user?.uid ?? "", store?.tenantId ?? "", orderId],
    queryFn: () => ok(api.GET("/v1/orders/{id}/payments", { params: { path: { id: orderId } } })),
    enabled: allowed,
    meta: { toast: false },
  });
  if (!allowed) return <>{fallback}</>;
  const l = q.data;
  const kind = (k: string) => (KINDS.has(k) ? td(`kind.${k as "sale"}`) : k);
  const method = (m: string) => (METHODS.has(m) ? td(`method.${m as "cod"}`) : m);
  const totals = l ? [
    { label: t("totals.paid"), value: <MoneyText money={l.paid} /> },
    ...(isZero(l.refunded) ? [] : [{ label: t("totals.refunded"), value: <MoneyText money={l.refunded} /> }]),
    ...(isZero(l.chargedBack) ? [] : [{ label: t("totals.chargedBack"), value: <MoneyText money={l.chargedBack} /> }]),
    { label: t("totals.net"), value: <strong><MoneyText money={l.net} /></strong> },
    { label: t("totals.balance"), value: <MoneyText money={l.balance} /> },
  ] : [];
  return (
    <Card title={t("title")} actions={l?.canRecord ? <Button size="sm" variant="secondary" icon="add" onClick={() => setOpen(true)}>{t("record")}</Button> : null}>
      <div className="flex flex-col gap-3" data-testid="ledger">
        {!l ? <p className="text-body-sm text-text-3">{q.isError ? problemText(q.error, tpr) : t("loading")}</p> : (
          <>
            {l.lines.length === 0 ? <p className="text-body-sm text-text-2">{t("empty")}</p> : (
              <ul className="flex flex-col divide-y divide-line">
                {l.lines.map((p) => (
                  <li key={p.id} className={`flex flex-wrap items-start justify-between gap-2 py-2.5 ${p.status === "succeeded" ? "" : "text-text-3"}`}>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span>
                        <span className="font-medium">{kind(p.kind)}</span>
                        <span className="text-text-2">{" · "}{method(p.method)}</span>
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5 text-caption text-text-3">
                        <Tag>{t(`source.${p.source}`)}</Tag>
                        {p.status === "succeeded" ? null : <Tag>{t(`status.${p.status as "pending"}`)}</Tag>}
                        <DateText value={p.occurredAt} />
                        {p.recordedBy ? <span>{t.rich("by", { name: p.recordedBy, b: (c) => <bdi>{c}</bdi> })}</span> : null}
                      </span>
                      {p.note ? <span dir="auto" className="text-caption text-text-2">{p.note}</span> : null}
                    </span>
                    <MoneyText money={p.amount} />
                  </li>
                ))}
              </ul>
            )}
            <KeyValue items={totals} />
          </>
        )}
      </div>
      {open && l ? <RecordPayment orderId={orderId} ledger={l} onClose={() => setOpen(false)} /> : null}
    </Card>
  );
}

function RecordPayment({ orderId, ledger, onClose }: { orderId: string; ledger: Ledger; onClose(): void }) {
  const t = useTranslations("orders.ledger");
  const td = useTranslations("orders.detail");
  const tpr = useTranslations("problem");
  const { api } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [type, setType] = useState<Body["type"]>("received");
  const [method, setMethod] = useState<Body["method"]>("bank_transfer");
  const [amount, setAmount] = useState(isZero(ledger.balance) ? "" : ledger.balance.amount);
  const [note, setNote] = useState("");
  const save = useMutation({
    mutationFn: () => ok(api.POST("/v1/orders/{id}/payments", { params: { path: { id: orderId } }, body: { type, method, amount: amount.trim(), ...(note.trim() ? { note: note.trim() } : {}) } })),
    meta: { toast: false },
    onSuccess: () => {
      toast({ message: t("recorded") });
      void qc.invalidateQueries({ queryKey: ["ledger"] });
      void qc.invalidateQueries({ queryKey: ["order"] });
      void qc.invalidateQueries({ queryKey: ["orderPnl"] });
      onClose();
    },
  });
  const err = save.error instanceof ApiError ? save.error : null;
  const message = err && REFUSALS.has(err.code) ? t(`refused.${err.code as "over_payment"}`)
    : err?.status === 422 ? t("invalidAmount") : save.isError ? problemText(save.error, tpr) : null;
  return (
    <Dialog open onClose={onClose} title={t("dialogTitle")} footer={(
      <>
        <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
        <Button busy={save.isPending} disabled={!amount.trim()} onClick={() => save.mutate()}>{t("save")}</Button>
      </>
    )}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (amount.trim()) save.mutate(); }}>
        <Segmented label={t("type.label")} value={type} onChange={setType}
          options={[{ value: "received", label: t("type.received") }, { value: "refunded", label: t("type.refunded") }]} />
        <Select label={t("method")} value={method} onChange={(e) => setMethod(e.target.value as Body["method"])}>
          {MANUAL.map((m) => <option key={m} value={m}>{td(`method.${m}`)}</option>)}
        </Select>
        <Field label={t("amount", { currency: ledger.currency })} hint={t.rich(type === "received" ? "owed" : "held", { amount: (type === "received" ? ledger.balance : ledger.net).amount, n: (c) => <bdi dir="ltr" className="mz-num">{c}</bdi> })}
          inputMode="decimal" ltr value={amount} onChange={(e) => setAmount(e.target.value)} error={err?.status === 422 ? t("invalidAmount") : undefined} />
        <TextArea label={t("note")} hint={t("noteHint")} maxLength={300} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        {message && err?.status !== 422 ? <Alert tone="danger">{message}</Alert> : null}
      </form>
    </Dialog>
  );
}

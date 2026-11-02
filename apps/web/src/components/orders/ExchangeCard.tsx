"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Bdi } from "@/components/Bdi";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonGroup } from "@/components/ui/Button";
import { IdCell } from "@/components/ui/DataTable";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Select, TextArea } from "@/components/ui/Field";
import { Card } from "@/components/ui/Surface";
import { useToast } from "@/components/ui/Toast";
import { MoneyText } from "@/components/ui/Values";
import { Link } from "@/i18n/navigation";
import { ok, type Schemas } from "@/lib/api/client";
import { useSession } from "@/lib/session";

type Order = Schemas["OrderDetail"];
type Exchange = Schemas["Exchange"];
type Reason = Schemas["NewExchange"]["reason"];
const MAKERS = new Set(["owner", "admin", "ops_manager", "agent"]);
const READERS = new Set(["owner", "admin", "ops_manager", "finance", "agent", "warehouse"]);
const REASONS: readonly Reason[] = ["wrong_size", "wrong_item", "damaged", "missing_item", "not_as_described", "quality", "changed_mind", "other"];
/** An item that is not in the catalogue: typed with its price. */
const OTHER = "__other__";
const isZero = (m: { amount: string }) => Number(m.amount) === 0;

/**
 * Exchanges on the order (M6, E10-2): what this delivered order was exchanged for (each a linked
 * replacement, the credit moved, what the courier collects or the refund due, and whether the items
 * are back), or the exchange a replacement settles. The team starts one from a delivered order.
 */
export function ExchangeCard({ order: o }: { order: Order }) {
  const t = useTranslations("exchanges");
  const { api, user, store } = useSession();
  const [open, setOpen] = useState(false);
  const role = store?.role ?? "";
  const q = useQuery({
    queryKey: ["exchanges", user?.uid ?? "", store?.tenantId ?? "", o.id],
    queryFn: () => ok(api.GET("/v1/orders/{id}/exchanges", { params: { path: { id: o.id } } })),
    enabled: READERS.has(role),
    meta: { toast: false },
  });
  const canMake = MAKERS.has(role) && o.status === "delivered";
  const d = q.data;
  if (!d || (!d.outgoing.length && !d.exchangeOf && !canMake)) return null;
  return (
    <Card title={t("title")} actions={canMake ? <Button size="sm" variant="secondary" icon="returns" onClick={() => setOpen(true)}>{t("new")}</Button> : null}>
      <div className="flex flex-col gap-3" data-testid="exchanges">
        {d.exchangeOf ? (
          <p className="text-body-sm">{t.rich("replacementOf", { link: () => <Link href={`/orders/${d.exchangeOf!.original.id}`} className="underline"><IdCell>{d.exchangeOf!.original.number}</IdCell></Link> })}</p>
        ) : null}
        {!d.outgoing.length && !d.exchangeOf ? <p className="text-body-sm text-text-2">{t("none")}</p> : null}
        <ul className="flex flex-col divide-y divide-line">
          {d.outgoing.map((x) => <ExchangeRow key={x.id} x={x} />)}
        </ul>
      </div>
      {open ? <NewExchange order={o} onClose={() => setOpen(false)} /> : null}
    </Card>
  );
}

function ExchangeRow({ x }: { x: Exchange }) {
  const t = useTranslations("exchanges");
  const tr = useTranslations("tickets.reason");
  return (
    <li className="flex flex-col gap-1 py-2.5 text-body-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>{t.rich("to", { link: () => <Link href={`/orders/${x.replacement.id}`} className="font-medium underline"><IdCell>{x.replacement.number}</IdCell></Link> })}{" · "}{tr(x.reason)}</span>
        <Badge tone={x.status === "returned" ? "success" : "warning"}>{t(`status.${x.status}`)}</Badge>
      </div>
      <span className="text-text-2">{x.items.map((i) => `${i.quantity}× ${i.title}`).join("، ")}</span>
      <span className="text-text-2">
        {t.rich("credit", { m: () => <MoneyText money={x.credit} /> })}
        {isZero(x.toCollect) ? null : <>{" · "}{t.rich("collect", { m: () => <MoneyText money={x.toCollect} /> })}</>}
        {isZero(x.refundDue) ? null : <>{" · "}<span className="text-warning-text">{t.rich("refundDue", { m: () => <MoneyText money={x.refundDue} /> })}</span></>}
      </span>
      {x.note ? <span dir="auto" className="text-text-3">{x.note}</span> : null}
    </li>
  );
}

function NewExchange({ order: o, onClose }: { order: Order; onClose(): void }) {
  const t = useTranslations("exchanges.form");
  const tr = useTranslations("tickets.reason");
  const { api, user, store } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [back, setBack] = useState<Record<string, number>>({});
  const [variantId, setVariantId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [shipping, setShipping] = useState("0");
  const [reason, setReason] = useState<Reason>("wrong_size");
  const [note, setNote] = useState("");
  const products = useQuery({
    queryKey: ["orderProducts", user?.uid ?? "", store?.tenantId ?? ""],
    queryFn: () => ok(api.GET("/v1/orders/products")),
  });
  const other = variantId === OTHER;
  const line = other ? { title: title.trim(), unitPrice: price.trim(), quantity } : { variantId, quantity };
  const lineReady = other ? title.trim().length > 0 && /^\d+(\.\d{1,2})?$/.test(price.trim()) : Boolean(variantId);
  const items = Object.entries(back).filter(([, n]) => n > 0).map(([lineId, n]) => ({ lineId, quantity: n }));
  const save = useMutation({
    mutationFn: () => ok(api.POST("/v1/exchanges", { body: {
      orderId: o.id, items, lines: [line], shipping: shipping.trim() || "0", reason, ...(note.trim() ? { note: note.trim() } : {}),
    } })),
    onSuccess: (x) => {
      toast({ message: t("created", { number: x.replacement.number }) });
      void qc.invalidateQueries({ queryKey: ["exchanges"] });
      void qc.invalidateQueries({ queryKey: ["order"] });
      onClose();
    },
  });
  return (
    <Dialog open onClose={onClose} title={t("title", { number: o.number })} description={t("body")} footer={(
      <ButtonGroup>
        <Button busy={save.isPending} disabled={!items.length || !lineReady || quantity < 1} onClick={() => save.mutate()}>{t("save")}</Button>
        <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
      </ButtonGroup>
    )}>
      <div className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-label">{t("back")}</legend>
          {o.lines.map((l) => (
            <label key={l.id} className="flex items-center justify-between gap-3 text-body-sm">
              <span>{l.title}{" "}<span className="text-text-3">{t("of", { n: l.quantity })}</span></span>
              <input type="number" min={0} max={l.quantity} value={back[l.id] ?? 0} aria-label={t("backQty", { title: l.title })}
                onChange={(e) => setBack((b) => ({ ...b, [l.id]: Math.max(0, Math.min(l.quantity, Number(e.target.value) || 0)) }))} className="mz-input w-20 text-center" />
            </label>
          ))}
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-[1fr_6rem]">
          <Select label={t("instead")} value={variantId} onChange={(e) => setVariantId(e.target.value)}>
            <option value="" disabled>{t("pick")}</option>
            {(products.data?.data ?? []).map((p) => <option key={p.variantId} value={p.variantId}>{p.title}</option>)}
            <option value={OTHER}>{t("other")}</option>
          </Select>
          <Field label={t("qty")} type="number" min={1} max={999} value={quantity} onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))} ltr />
        </div>
        {other ? (
          <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
            <Field label={t("itemTitle")} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} dir="auto" />
            <Field label={t("unitPrice")} value={price} inputMode="decimal" onChange={(e) => setPrice(e.target.value)} ltr />
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("shipping")} hint={t("shippingHint")} value={shipping} inputMode="decimal" onChange={(e) => setShipping(e.target.value)} ltr />
          <Select label={t("reason")} value={reason} onChange={(e) => setReason(e.target.value as Reason)}>
            {REASONS.map((r) => <option key={r} value={r}>{tr(r)}</option>)}
          </Select>
        </div>
        <TextArea label={t("note")} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} dir="auto" />
        <p className="text-caption text-text-3">{t("money")}{" "}<Bdi>{o.number}</Bdi></p>
      </div>
    </Dialog>
  );
}

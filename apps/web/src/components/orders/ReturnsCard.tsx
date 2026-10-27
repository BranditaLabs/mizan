"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, TextArea } from "@/components/ui/Field";
import { Card } from "@/components/ui/Surface";
import { useToast } from "@/components/ui/Toast";
import { DateText } from "@/components/ui/Values";
import { ApiError, ok, type Schemas } from "@/lib/api/client";
import { problemText } from "@/lib/api/query";
import { useSession } from "@/lib/session";

type State = Schemas["ReturnState"];
type Outcome = State["inspections"][number]["outcome"];
const READERS = new Set(["owner", "admin", "ops_manager", "finance", "warehouse"]);
const OUTCOMES: readonly Outcome[] = ["restock", "damaged", "write_off"];

/**
 * What came back on a returned or delivered order (M6, E10-3): per line, how many units were
 * sellable (back into stock), damaged or written off (their cost counts on the order's profit),
 * and how many are still to inspect. The warehouse and managers record an inspection.
 */
export function ReturnsCard({ orderId }: { orderId: string }) {
  const t = useTranslations("returns");
  const { api, user, store } = useSession();
  const allowed = READERS.has(store?.role ?? "");
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["returns", user?.uid ?? "", store?.tenantId ?? "", orderId],
    queryFn: () => ok(api.GET("/v1/orders/{id}/returns", { params: { path: { id: orderId } } })),
    enabled: allowed,
    meta: { toast: false },
  });
  const s = q.data;
  if (!allowed || !s?.eligible) return null;
  const left = s.lines.reduce((a, l) => a + l.remaining, 0);
  return (
    <Card title={t("title")} actions={s.canInspect ? <Button size="sm" variant="secondary" icon="scan" onClick={() => setOpen(true)}>{t("inspect")}</Button> : null}>
      <div className="flex flex-col gap-3" data-testid="returns">
        <p className="text-body-sm text-text-2">{left ? t("left", { count: left }) : t("done")}</p>
        <ul className="flex flex-col divide-y divide-line">
          {s.lines.map((l) => (
            <li key={l.lineId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-body-sm">
              <span className="flex flex-col">
                <span className="font-medium">{l.title}</span>
                {l.sku ? <bdi className="mz-id text-caption text-text-3">{l.sku}</bdi> : null}
              </span>
              <span className="text-text-2">{t("counts", { restock: l.restock, damaged: l.damaged, writeOff: l.writeOff, remaining: l.remaining })}</span>
            </li>
          ))}
        </ul>
        {s.inspections.length ? (
          <ul className="flex flex-col gap-1 border-t border-line pt-2 text-caption text-text-3">
            {s.inspections.map((i) => (
              <li key={i.id}>
                {t("record", { quantity: i.quantity, title: i.title, outcome: t(`outcome.${i.outcome}`) })}
                {" · "}<DateText value={i.at} />{i.by ? <>{" · "}<bdi>{i.by}</bdi></> : null}
                {i.note ? <span dir="auto" className="block text-text-2">{i.note}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {open ? <Inspect state={s} onClose={() => setOpen(false)} /> : null}
    </Card>
  );
}

function Inspect({ state, onClose }: { state: State; onClose(): void }) {
  const t = useTranslations("returns");
  const tpr = useTranslations("problem");
  const { api } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const open = state.lines.filter((l) => l.remaining > 0);
  // Sellable unless said otherwise: the usual case is one tap.
  const [qty, setQty] = useState<Record<string, Record<Outcome, string>>>(() =>
    Object.fromEntries(open.map((l) => [l.lineId, { restock: String(l.remaining), damaged: "0", write_off: "0" }])));
  const [note, setNote] = useState("");
  const items = open.flatMap((l) => OUTCOMES.map((o) => ({ lineId: l.lineId, outcome: o, quantity: Number(qty[l.lineId]?.[o] ?? 0) }))).filter((i) => Number.isInteger(i.quantity) && i.quantity > 0);
  const over = open.some((l) => OUTCOMES.reduce((a, o) => a + (Number(qty[l.lineId]?.[o]) || 0), 0) > l.remaining);
  const save = useMutation({
    mutationFn: () => ok(api.POST("/v1/orders/{id}/returns/inspect", { params: { path: { id: state.orderId } }, body: { items, ...(note.trim() ? { note: note.trim() } : {}) } })),
    meta: { toast: false },
    onSuccess: () => {
      toast({ message: t("saved") });
      for (const k of ["returns", "orderPnl", "stock", "order"]) void qc.invalidateQueries({ queryKey: [k] });
      onClose();
    },
  });
  const error = save.error instanceof ApiError && save.error.code === "over_quantity" ? t("over") : save.isError ? problemText(save.error, tpr) : null;
  return (
    <Dialog open onClose={onClose} title={t("inspectTitle")} description={t("inspectHint")} footer={(
      <>
        <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
        <Button busy={save.isPending} disabled={!items.length || over} onClick={() => save.mutate()}>{t("save")}</Button>
      </>
    )}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (items.length && !over) save.mutate(); }}>
        {open.map((l) => (
          <fieldset key={l.lineId} className="flex flex-col gap-2" aria-label={l.title}>
            <legend className="text-label">{l.title}{" · "}<span className="text-text-2">{t("ofRemaining", { remaining: l.remaining })}</span></legend>
            <div className="grid grid-cols-3 gap-2">
              {OUTCOMES.map((o) => (
                <Field key={o} label={t(`outcome.${o}`)} inputMode="numeric" ltr value={qty[l.lineId]?.[o] ?? "0"}
                  onChange={(e) => setQty((q) => ({ ...q, [l.lineId]: { ...q[l.lineId]!, [o]: e.target.value.replace(/[^0-9٠-٩]/g, "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))) } }))} />
              ))}
            </div>
          </fieldset>
        ))}
        <TextArea label={t("note")} maxLength={300} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        {over ? <Alert tone="warning">{t("over")}</Alert> : null}
        {error && !over ? <Alert tone="danger">{error}</Alert> : null}
      </form>
    </Dialog>
  );
}

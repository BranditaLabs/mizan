"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonGroup } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select, TextArea } from "@/components/ui/Field";
import { Card } from "@/components/ui/Surface";
import { useToast } from "@/components/ui/Toast";
import { MoneyText } from "@/components/ui/Values";
import { ok, type Schemas } from "@/lib/api/client";
import { useSession } from "@/lib/session";

type Order = Schemas["OrderDetail"];
type Reason = Schemas["Refusal"]["reason"];
const REASONS: readonly Reason[] = ["changed_mind", "wrong_item", "wrong_size", "damaged", "not_as_described", "quality", "price", "late_delivery", "courier_behaviour", "other"];
const PARTIAL = new Set(["owner", "admin", "ops_manager", "warehouse"]);
const REFUSAL = new Set(["owner", "admin", "ops_manager", "agent", "warehouse"]);

/**
 * At the door (M6, E10-4): the customer kept part of the order (what they owe now, the rest comes
 * back for inspection), or refused it — why, and whether they opened the box (المعاينة).
 */
export function DoorCard({ order: o }: { order: Order }) {
  const t = useTranslations("door");
  const tr = useTranslations("tickets.reason");
  const { store } = useSession();
  const role = store?.role ?? "";
  const [dialog, setDialog] = useState<"partial" | "refusal" | null>(null);
  const canPartial = PARTIAL.has(role) && ["shipped", "delivered"].includes(o.status) && !o.partialDelivery;
  const canRefuse = REFUSAL.has(role) && ["shipped", "returned"].includes(o.status);
  if (!o.partialDelivery && !o.refusal && !canPartial && !canRefuse) return null;
  return (
    <Card title={t("title")} actions={(canPartial || canRefuse) ? (
      <ButtonGroup>
        {canPartial ? <Button size="sm" variant="secondary" onClick={() => setDialog("partial")}>{t("partial.open")}</Button> : null}
        {canRefuse ? <Button size="sm" variant="secondary" onClick={() => setDialog("refusal")}>{o.refusal ? t("refusal.correct") : t("refusal.open")}</Button> : null}
      </ButtonGroup>
    ) : null}>
      <div className="flex flex-col gap-2 text-body-sm" data-testid="door">
        {!o.partialDelivery && !o.refusal ? <p className="text-text-2">{t("none")}</p> : null}
        {o.partialDelivery ? (
          <p>{t.rich("partial.done", { m: () => <MoneyText money={o.partialDelivery!.due} />, n: o.partialDelivery.items.reduce((a, i) => a + i.quantity, 0) })}</p>
        ) : null}
        {o.refusal ? (
          <p className="flex flex-wrap items-center gap-2">
            <span>{t("refusal.done", { reason: REASONS.includes(o.refusal.reason as Reason) ? tr(o.refusal.reason as Reason) : o.refusal.reason })}</span>
            {o.refusal.openBox ? <Badge tone="warning">{t("refusal.openBox")}</Badge> : null}
          </p>
        ) : null}
      </div>
      {dialog === "partial" ? <PartialDialog order={o} onClose={() => setDialog(null)} /> : null}
      {dialog === "refusal" ? <RefusalDialog order={o} onClose={() => setDialog(null)} /> : null}
    </Card>
  );
}

function PartialDialog({ order: o, onClose }: { order: Order; onClose(): void }) {
  const t = useTranslations("door.partial");
  const { api } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [kept, setKept] = useState<Record<string, number>>({});
  const [note, setNote] = useState("");
  const items = Object.entries(kept).filter(([, n]) => n > 0).map(([lineId, quantity]) => ({ lineId, quantity }));
  const all = o.lines.every((l) => (kept[l.id] ?? 0) >= l.quantity);
  const save = useMutation({
    mutationFn: () => ok(api.POST("/v1/orders/{id}/partial-delivery", { params: { path: { id: o.id } }, body: { kept: items, ...(note.trim() ? { note: note.trim() } : {}) } })),
    onSuccess: () => { toast({ message: t("saved") }); void qc.invalidateQueries({ queryKey: ["order"] }); void qc.invalidateQueries({ queryKey: ["returns"] }); onClose(); },
  });
  return (
    <Dialog open onClose={onClose} title={t("title")} description={t("body")} footer={(
      <ButtonGroup>
        <Button busy={save.isPending} disabled={!items.length || all} onClick={() => save.mutate()}>{t("save")}</Button>
        <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
      </ButtonGroup>
    )}>
      <div className="flex flex-col gap-3">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-label">{t("kept")}</legend>
          {o.lines.map((l) => (
            <label key={l.id} className="flex items-center justify-between gap-3 text-body-sm">
              <span>{l.title}{" "}<span className="text-text-3">{t("of", { n: l.quantity })}</span></span>
              <input type="number" min={0} max={l.quantity} value={kept[l.id] ?? 0} aria-label={t("keptQty", { title: l.title })}
                onChange={(e) => setKept((k) => ({ ...k, [l.id]: Math.max(0, Math.min(l.quantity, Number(e.target.value) || 0)) }))} className="mz-input w-20 text-center" />
            </label>
          ))}
        </fieldset>
        {all ? <p className="text-caption text-warning-text">{t("all")}</p> : null}
        <TextArea label={t("note")} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} dir="auto" />
      </div>
    </Dialog>
  );
}

function RefusalDialog({ order: o, onClose }: { order: Order; onClose(): void }) {
  const t = useTranslations("door.refusal");
  const tr = useTranslations("tickets.reason");
  const { api } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState<Reason>((o.refusal?.reason as Reason | undefined) ?? "changed_mind");
  const [openBox, setOpenBox] = useState(o.refusal?.openBox ?? false);
  const [note, setNote] = useState("");
  const save = useMutation({
    mutationFn: () => ok(api.POST("/v1/orders/{id}/refusal", { params: { path: { id: o.id } }, body: { reason, openBox, ...(note.trim() ? { note: note.trim() } : {}) } })),
    onSuccess: () => { toast({ message: t("saved") }); void qc.invalidateQueries({ queryKey: ["order"] }); onClose(); },
  });
  return (
    <Dialog open onClose={onClose} title={t("title")} description={t("body")} footer={(
      <ButtonGroup>
        <Button busy={save.isPending} onClick={() => save.mutate()}>{t("save")}</Button>
        <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
      </ButtonGroup>
    )}>
      <div className="flex flex-col gap-3">
        <Select label={t("reason")} value={reason} onChange={(e) => setReason(e.target.value as Reason)}>
          {REASONS.map((r) => <option key={r} value={r}>{tr(r)}</option>)}
        </Select>
        <label className="flex items-center gap-2 text-body-sm">
          <input type="checkbox" checked={openBox} onChange={(e) => setOpenBox(e.target.checked)} />
          {t("openBoxLabel")}
        </label>
        <TextArea label={t("note")} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} dir="auto" />
      </div>
    </Dialog>
  );
}

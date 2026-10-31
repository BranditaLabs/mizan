"use client";

import { Icon } from "@mizan/design-system/icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CheckboxOnly } from "@/components/ui/Choice";
import { Field } from "@/components/ui/Field";
import { Card, EmptyState, SkeletonRows } from "@/components/ui/Surface";
import { useToast } from "@/components/ui/Toast";
import { MoneyText } from "@/components/ui/Values";
import { Link, useRouter } from "@/i18n/navigation";
import { ok, type Schemas } from "@/lib/api/client";
import { problemText } from "@/lib/api/query";
import { useSession } from "@/lib/session";
import { MANAGERS, SUPPLIER_READERS } from "./purchasing-ui";

type Row = Schemas["ReorderSuggestions"]["data"][number];
const QTY = /^[1-9]\d{0,5}$/;

/**
 * Reorder suggestions (M16-4b): what will run out before a new delivery could arrive, grouped by
 * the supplier it was last bought from, the least cover first. Tick, adjust the quantities, and
 * make a draft PO per supplier. Nothing is ordered without someone approving it.
 */
export function ReorderScreen() {
  const t = useTranslations("purchasing");
  const { api, user, store } = useSession();
  const role = store?.role ?? "";
  const q = useQuery({
    queryKey: ["reorder", user?.uid ?? "", store?.tenantId ?? ""],
    queryFn: () => ok(api.GET("/v1/reorder-suggestions")),
    enabled: Boolean(store) && SUPPLIER_READERS.has(role),
  });
  const back = <Link href="/purchasing" className="inline-flex items-center gap-1.5 text-body-sm text-text-2 hover:text-text"><Icon name="back" size={16} />{t("back")}</Link>;
  const frame = (body: React.ReactNode) => <div className="mx-auto flex max-w-[1200px] flex-col gap-5 px-4 pt-6 pb-14 md:px-6" data-testid="reorder">{back}{body}</div>;
  if (!SUPPLIER_READERS.has(role)) return frame(<div className="mz-card"><EmptyState icon="locked" title={t("notAllowed.title")} body={t("notAllowed.suppliers")} /></div>);
  const groups = new Map<string, { supplier: Row["supplier"]; rows: Row[] }>();
  for (const r of q.data?.data ?? []) {
    const key = r.supplier?.id ?? "";
    groups.set(key, { supplier: r.supplier, rows: [...(groups.get(key)?.rows ?? []), r] });
  }
  const s = q.data?.settings;
  return frame(
    <>
      <header>
        <h1 className="font-display text-heading-lg">{t("reorder.title")}</h1>
        <p className="mt-1 max-w-[75ch] text-body-sm text-text-2">
          {s ? t("reorder.subtitle", { velocity: s.velocityDays, safety: s.safetyDays, target: s.targetCoverDays }) : null}
        </p>
      </header>
      {q.isPending ? <div className="mz-card"><SkeletonRows rows={4} label={t("loading")} /></div>
        : !groups.size ? <div className="mz-card"><EmptyState icon="stock" title={t("reorder.empty.title")} body={t("reorder.empty.body")} /></div>
        : [...groups.values()].map((g) => <SupplierGroup key={g.supplier?.id ?? "none"} supplier={g.supplier} rows={g.rows} canDraft={MANAGERS.has(role)} />)}
    </>,
  );
}

function SupplierGroup({ supplier, rows, canDraft }: { supplier: Row["supplier"]; rows: Row[]; canDraft: boolean }) {
  const t = useTranslations("purchasing");
  const tpr = useTranslations("problem");
  const { api } = useSession();
  const qc = useQueryClient();
  const router = useRouter();
  const toast = useToast();
  const [picked, setPicked] = useState<Record<string, boolean>>(() => Object.fromEntries(rows.map((r) => [r.variantId, true])));
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(rows.map((r) => [r.variantId, String(r.suggested)])));
  const items = rows.filter((r) => picked[r.variantId]).map((r) => ({ variantId: r.variantId, quantity: Number(qty[r.variantId]) }));
  const valid = items.length > 0 && rows.filter((r) => picked[r.variantId]).every((r) => QTY.test(qty[r.variantId] ?? ""));
  const draft = useMutation({
    mutationFn: () => ok(api.POST("/v1/purchase-orders/from-suggestions", { body: { supplierId: supplier!.id, items } })),
    meta: { toast: false },
    onSuccess: (po) => {
      toast({ message: t("created", { number: po.number }) });
      void qc.invalidateQueries({ queryKey: ["purchaseOrders"] });
      void qc.invalidateQueries({ queryKey: ["reorder"] });
      router.push(`/purchasing/${po.id}`);
    },
  });
  return (
    <Card title={supplier ? <bdi>{supplier.name}</bdi> : t("reorder.noSupplier")}>
      <div className="flex flex-col gap-3">
        {!supplier ? <p className="text-caption text-text-3">{t("reorder.noSupplierHint")}</p> : null}
        <ul className="flex flex-col divide-y divide-line">
          {rows.map((r) => (
            <li key={r.variantId} className="flex flex-wrap items-end gap-3 py-3">
              {supplier && canDraft ? (
                <CheckboxOnly label={t("reorder.pick", { title: r.title })} checked={Boolean(picked[r.variantId])} onChange={(e) => setPicked({ ...picked, [r.variantId]: e.target.checked })} />
              ) : null}
              <div className="min-w-48 flex-1">
                <p className="text-body-sm font-medium">{r.title}{r.sku ? <> · <bdi className="mz-id">{r.sku}</bdi></> : null}</p>
                <p className="text-caption text-text-2">
                  {t("reorder.numbers", { available: r.available, incoming: r.incoming, velocity: r.velocity, lead: r.leadDays })}
                  {r.lastUnitCost ? <> · {t("reorder.lastPrice")} <MoneyText money={r.lastUnitCost} /></> : null}
                </p>
              </div>
              <Badge tone={r.daysCover !== null && r.daysCover <= r.leadDays ? "danger" : "warning"}>{t("reorder.cover", { days: r.daysCover ?? 0 })}</Badge>
              <Field label={t("reorder.quantity")} ltr inputMode="numeric" className="w-28" value={qty[r.variantId] ?? ""} disabled={!supplier || !canDraft}
                onChange={(e) => setQty({ ...qty, [r.variantId]: e.target.value.trim() })}
                error={picked[r.variantId] && !QTY.test(qty[r.variantId] ?? "") ? t("errors.quantity") : null}
                hint={r.packSize > 1 ? t("reorder.pack", { n: r.packSize }) : undefined} />
            </li>
          ))}
        </ul>
        {draft.isError ? <Alert tone="danger">{problemText(draft.error, tpr)}</Alert> : null}
        {supplier && canDraft ? <div><Button icon="purchasing" busy={draft.isPending} disabled={!valid} onClick={() => draft.mutate()}>{t("reorder.draft", { count: items.length })}</Button></div> : null}
      </div>
    </Card>
  );
}

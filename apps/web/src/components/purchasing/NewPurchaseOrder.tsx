"use client";

import { Icon } from "@mizan/design-system/icons/react";
import { fromMinor, toMinor } from "@mizan/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button, buttonClass, IconButton } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { Field, Select, TextArea } from "@/components/ui/Field";
import { Card, EmptyState, KeyValue, SkeletonRows } from "@/components/ui/Surface";
import { useToast } from "@/components/ui/Toast";
import { MoneyText } from "@/components/ui/Values";
import { Link, useRouter } from "@/i18n/navigation";
import { ok } from "@/lib/api/client";
import { problemText } from "@/lib/api/query";
import { useSession } from "@/lib/session";
import { AMOUNT, MANAGERS } from "./purchasing-ui";

interface Line { variantId: string; title: string; sku: string | null; quantity: string; unitCost: string }
const QTY = /^[1-9]\d{0,5}$/;

/**
 * New purchase order (M16-2): a supplier, what to buy at what unit cost (in the supplier's
 * currency unless changed), and when it should arrive. Saved as a draft to approve.
 */
export function NewPurchaseOrder() {
  const t = useTranslations("purchasing");
  const tpr = useTranslations("problem");
  const { api, user, store } = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const allowed = MANAGERS.has(store?.role ?? "");
  const [supplierId, setSupplierId] = useState("");
  const [currency, setCurrency] = useState<string | null>(null);
  const [expectedAt, setExpectedAt] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [tried, setTried] = useState(false);

  const suppliers = useQuery({
    queryKey: ["suppliers", user?.uid ?? "", store?.tenantId ?? "", false],
    queryFn: () => ok(api.GET("/v1/suppliers", { params: { query: { archived: "false" } } })),
    enabled: Boolean(store) && allowed,
  });
  const products = useQuery({
    queryKey: ["orderProducts", user?.uid ?? "", store?.tenantId ?? ""],
    queryFn: () => ok(api.GET("/v1/orders/products")),
    enabled: Boolean(store) && allowed,
  });
  const supplier = suppliers.data?.data.find((s) => s.id === supplierId);
  const cur = currency ?? supplier?.currency ?? store?.baseCurrency ?? "EGP";
  const create = useMutation({
    mutationFn: () => ok(api.POST("/v1/purchase-orders", { body: {
      supplierId, currency: cur, ...(expectedAt ? { expectedAt } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}),
      lines: lines.map((l) => ({ variantId: l.variantId, quantity: Number(l.quantity), unitCost: l.unitCost.trim() })),
    } })),
    meta: { toast: false },
    onSuccess: (po) => { toast({ message: t("created", { number: po.number }) }); void qc.invalidateQueries({ queryKey: ["purchaseOrders"] }); router.push(`/purchasing/${po.id}`); },
  });

  const frame = (body: React.ReactNode) => (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-5 px-4 pt-6 pb-14 md:px-6" data-testid="new-po">
      <Link href="/purchasing" className="inline-flex items-center gap-1.5 text-body-sm text-text-2 hover:text-text"><Icon name="back" size={16} />{t("back")}</Link>
      {body}
    </div>
  );
  if (!allowed) return frame(<div className="mz-card"><EmptyState icon="locked" title={t("notAllowed.title")} body={t("notAllowed.managers")} /></div>);
  if (suppliers.isPending) return frame(<div className="mz-card"><SkeletonRows rows={4} label={t("loading")} /></div>);
  if (!suppliers.data?.data.length) {
    return frame(<div className="mz-card"><EmptyState icon="supplier" title={t("noSuppliers.title")} body={t("noSuppliers.body")}
      action={<Link href="/purchasing/suppliers" className={buttonClass("primary")}>{t("noSuppliers.cta")}</Link>} /></div>);
  }

  const minor = (v: string) => { try { return AMOUNT.test(v.trim()) ? toMinor(v.trim(), cur) : null; } catch { return null; } };
  const lineError = (l: Line) => (!QTY.test(l.quantity.trim()) ? t("errors.quantity") : minor(l.unitCost) === null ? t("errors.amount") : null);
  const total = lines.reduce((s, l) => s + (minor(l.unitCost) ?? 0n) * BigInt(QTY.test(l.quantity) ? Number(l.quantity) : 0), 0n);
  const problems = { supplier: !supplierId ? t("errors.supplier") : null, lines: !lines.length ? t("errors.lines") : lines.some(lineError) ? t("errors.fixLines") : null };
  const show = (e: string | null) => (tried ? e : null);
  const options = (products.data?.data ?? []).filter((p) => !lines.some((l) => l.variantId === p.variantId)).map((p) => ({ value: p.variantId, label: p.title, hint: p.sku ?? undefined }));
  const add = (variantId: string) => {
    const p = products.data?.data.find((x) => x.variantId === variantId);
    if (p) setLines((ls) => [...ls, { variantId, title: p.title, sku: p.sku, quantity: "1", unitCost: "" }]);
  };
  const set = (variantId: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.variantId === variantId ? { ...l, ...patch } : l)));
  const submit = () => { setTried(true); if (!problems.supplier && !problems.lines) create.mutate(); };

  return frame(
    <>
      <header>
        <h1 className="font-display text-heading-lg">{t("new.title")}</h1>
        <p className="mt-1 text-body-sm text-text-2">{t("new.subtitle")}</p>
      </header>
      <form className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="flex min-w-0 flex-col gap-4">
          <Card title={t("new.supplier")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Select label={t("fields.supplier")} value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setCurrency(null); }} error={show(problems.supplier)}>
                <option value="">{t("new.pickSupplier")}</option>
                {suppliers.data.data.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
              <Field label={t("fields.currency")} hint={t("new.currencyHint")} ltr maxLength={3} value={cur} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
              <Field label={t("fields.expectedAt")} type="date" ltr value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} />
              <TextArea label={t("fields.notes")} maxLength={500} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="sm:col-span-2" />
            </div>
          </Card>
          <Card title={t("new.items")}>
            <div className="flex flex-col gap-4">
              <Combobox label={t("new.pickItem")} options={options} value={null} onChange={add} emptyText={t("new.noProducts")} placeholder={t("new.pickPlaceholder")} />
              {lines.length ? (
                <ul className="flex flex-col divide-y divide-line" data-testid="po-lines">
                  {lines.map((l) => (
                    <li key={l.variantId} className="flex flex-wrap items-end gap-3 py-3">
                      <div className="min-w-40 flex-1">
                        <p className="text-body-sm font-medium">{l.title}</p>
                        {l.sku ? <p className="text-caption text-text-3"><bdi className="mz-id">{l.sku}</bdi></p> : null}
                      </div>
                      <Field label={t("fields.quantity")} ltr inputMode="numeric" className="w-24" value={l.quantity} onChange={(e) => set(l.variantId, { quantity: e.target.value })}
                        error={tried && !QTY.test(l.quantity.trim()) ? t("errors.quantity") : null} />
                      <Field label={t("fields.unitCost", { currency: cur })} ltr inputMode="decimal" className="w-36" value={l.unitCost} onChange={(e) => set(l.variantId, { unitCost: e.target.value })}
                        error={tried && minor(l.unitCost) === null ? t("errors.amount") : null} />
                      <IconButton icon="delete" label={t("new.remove", { title: l.title })} onClick={() => setLines((ls) => ls.filter((x) => x.variantId !== l.variantId))} />
                    </li>
                  ))}
                </ul>
              ) : <p className="text-body-sm text-text-2">{t("new.empty")}</p>}
              {show(problems.lines) ? <p className="text-body-sm text-danger-text" role="alert">{problems.lines}</p> : null}
            </div>
          </Card>
        </div>
        <aside className="flex flex-col gap-4 lg:sticky lg:top-6">
          <Card title={t("new.summary")}>
            <div className="flex flex-col gap-3">
              <KeyValue items={[
                { label: t("fields.supplier"), value: supplier ? <bdi>{supplier.name}</bdi> : "—" },
                { label: t("columns.items"), value: t("itemsUnits", { items: lines.length, units: lines.reduce((s, l) => s + (QTY.test(l.quantity) ? Number(l.quantity) : 0), 0) }) },
                { label: t("columns.total"), value: <MoneyText money={fromMinor(total, cur)} /> },
              ]} />
              <p className="text-caption text-text-3">{t("new.draftHint")}</p>
              {create.isError ? <Alert tone="danger">{problemText(create.error, tpr)}</Alert> : null}
              <Button type="submit" busy={create.isPending}>{t("new.save")}</Button>
            </div>
          </Card>
        </aside>
      </form>
    </>,
  );
}

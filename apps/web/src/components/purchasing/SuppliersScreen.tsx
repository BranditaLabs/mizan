"use client";

import { Icon } from "@mizan/design-system/icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Cell, DataTable, type Column } from "@/components/ui/DataTable";
import { Dialog } from "@/components/ui/Dialog";
import { Field, TextArea } from "@/components/ui/Field";
import { EmptyState, SkeletonRows } from "@/components/ui/Surface";
import { Tabs } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";
import { Link } from "@/i18n/navigation";
import { ApiError, ok, type Schemas } from "@/lib/api/client";
import { problemText } from "@/lib/api/query";
import { useSession } from "@/lib/session";
import { MANAGERS, SUPPLIER_READERS } from "./purchasing-ui";

type Supplier = Schemas["Supplier"];
type View = "active" | "archived";

/** M16 suppliers (M16-2): who the store buys from, in which currency, how long they take. */
export function SuppliersScreen() {
  const t = useTranslations("purchasing");
  const { api, user, store } = useSession();
  const role = store?.role ?? "";
  const [view, setView] = useState<View>("active");
  const [editing, setEditing] = useState<Supplier | "new" | null>(null);
  const list = useQuery({
    queryKey: ["suppliers", user?.uid ?? "", store?.tenantId ?? "", view === "archived"],
    queryFn: () => ok(api.GET("/v1/suppliers", { params: { query: { archived: view === "archived" ? "true" : "false" } } })),
    enabled: Boolean(store) && SUPPLIER_READERS.has(role),
  });
  const back = <Link href="/purchasing" className="inline-flex items-center gap-1.5 text-body-sm text-text-2 hover:text-text"><Icon name="back" size={16} />{t("back")}</Link>;
  if (!SUPPLIER_READERS.has(role)) {
    return <div className="mx-auto flex max-w-[960px] flex-col gap-5 px-4 pt-6 md:px-6">{back}<div className="mz-card"><EmptyState icon="locked" title={t("notAllowed.title")} body={t("notAllowed.suppliers")} /></div></div>;
  }
  const manager = MANAGERS.has(role);
  const columns: Column<Supplier>[] = [
    { id: "name", header: t("supplier.name"), cell: (s) => <Cell main={<bdi>{s.name}</bdi>} sub={s.contactName ? <bdi>{s.contactName}</bdi> : null} /> },
    { id: "currency", header: t("fields.currency"), cell: (s) => <bdi className="mz-id">{s.currency}</bdi> },
    { id: "lead", header: t("supplier.leadTime"), numeric: true, cell: (s) => (s.leadTimeDays === null ? <span className="text-text-3">—</span> : t("supplier.days", { n: s.leadTimeDays })) },
    { id: "contact", header: t("supplier.contact"), cell: (s) => <Cell main={s.phone ? <bdi className="mz-id">{s.phone}</bdi> : "—"} sub={s.email ? <bdi>{s.email}</bdi> : null} /> },
    { id: "open", header: t("supplier.openOrders"), numeric: true, cell: (s) => <span className="mz-num">{s.openOrders}</span> },
    ...(manager ? [{ id: "edit", header: "", cell: (s: Supplier) => <Button variant="ghost" size="sm" icon="edit" onClick={() => setEditing(s)}>{t("supplier.edit")}</Button> }] : []),
  ];
  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-5 px-4 pt-6 pb-14 md:px-6" data-testid="suppliers">
      {back}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-heading-lg">{t("suppliers")}</h1>
          <p className="mt-1 text-body-sm text-text-2">{t("supplier.subtitle")}</p>
        </div>
        {manager ? <Button icon="add" onClick={() => setEditing("new")}>{t("supplier.new")}</Button> : null}
      </header>
      <Tabs label={t("suppliers")} value={view} onChange={setView} items={[{ value: "active", label: t("supplier.active") }, { value: "archived", label: t("supplier.archived") }]}>
        {list.isPending ? <div className="mz-card"><SkeletonRows rows={4} label={t("loading")} /></div>
          : <DataTable label={t("suppliers")} columns={columns} rows={list.data?.data ?? []} rowKey={(s) => s.id} rowLabel={(s) => s.name}
              empty={<EmptyState icon="supplier" title={t(view === "archived" ? "supplier.noneArchived" : "noSuppliers.title")} body={view === "archived" ? "" : t("noSuppliers.body")} />} />}
      </Tabs>
      {editing ? <SupplierDialog supplier={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function SupplierDialog({ supplier, onClose }: { supplier: Supplier | null; onClose(): void }) {
  const t = useTranslations("purchasing");
  const tpr = useTranslations("problem");
  const { api, store } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({
    name: supplier?.name ?? "", currency: supplier?.currency ?? store?.baseCurrency ?? "EGP", contactName: supplier?.contactName ?? "", phone: supplier?.phone ?? "",
    email: supplier?.email ?? "", leadTimeDays: supplier?.leadTimeDays === null || supplier?.leadTimeDays === undefined ? "" : String(supplier.leadTimeDays),
    paymentTerms: supplier?.paymentTerms ?? "", notes: supplier?.notes ?? "",
  });
  const lead = /^\d{0,3}$/.test(f.leadTimeDays.trim()) ? f.leadTimeDays.trim() : null;
  const errors = { name: !f.name.trim() ? t("errors.name") : null, currency: !/^[A-Z]{3}$/.test(f.currency) ? t("errors.currency") : null, lead: lead === null ? t("errors.count") : null };
  const [tried, setTried] = useState(false);
  const body = {
    name: f.name.trim(), currency: f.currency, contactName: f.contactName.trim(), phone: f.phone.trim(), paymentTerms: f.paymentTerms.trim(), notes: f.notes.trim(),
    ...(f.email.trim() ? { email: f.email.trim() } : {}), ...(lead ? { leadTimeDays: Number(lead) } : {}),
  };
  const save = useMutation({
    mutationFn: (archived?: boolean) => (supplier
      ? ok(api.PATCH("/v1/suppliers/{id}", { params: { path: { id: supplier.id } }, body: archived === undefined ? body : { archived } }))
      : ok(api.POST("/v1/suppliers", { body }))),
    meta: { toast: false },
    onSuccess: (_s, archived) => {
      toast({ message: archived === true ? t("supplier.archivedDone") : archived === false ? t("supplier.restored") : t("supplier.saved") });
      void qc.invalidateQueries({ queryKey: ["suppliers"] });
      onClose();
    },
  });
  const message = save.error instanceof ApiError && save.error.code === "supplier_exists" ? t("supplier.exists") : save.isError ? problemText(save.error, tpr) : null;
  const submit = () => { setTried(true); if (!errors.name && !errors.currency && !errors.lead) save.mutate(undefined); };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: k === "currency" ? e.target.value.toUpperCase() : e.target.value });
  return (
    <Dialog open onClose={onClose} title={supplier ? t("supplier.editTitle") : t("supplier.new")} footer={(
      <>
        {supplier ? <Button variant="ghost" className="me-auto" busy={save.isPending && save.variables !== undefined} onClick={() => save.mutate(!supplier.archived)}>{supplier.archived ? t("supplier.restore") : t("supplier.archive")}</Button> : null}
        <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
        <Button busy={save.isPending && save.variables === undefined} onClick={submit}>{t("supplier.save")}</Button>
      </>
    )}>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Field label={t("supplier.name")} className="sm:col-span-2" maxLength={120} value={f.name} onChange={set("name")} error={tried ? errors.name : null} />
        <Field label={t("fields.currency")} hint={t("supplier.currencyHint")} ltr maxLength={3} value={f.currency} onChange={set("currency")} error={tried ? errors.currency : null} />
        <Field label={t("supplier.leadTime")} hint={t("supplier.leadTimeHint")} ltr inputMode="numeric" value={f.leadTimeDays} onChange={set("leadTimeDays")} error={tried ? errors.lead : null} />
        <Field label={t("supplier.contactName")} maxLength={120} value={f.contactName} onChange={set("contactName")} />
        <Field label={t("supplier.phone")} ltr type="tel" maxLength={32} value={f.phone} onChange={set("phone")} />
        <Field label={t("supplier.email")} ltr type="email" maxLength={200} value={f.email} onChange={set("email")} />
        <Field label={t("supplier.terms")} maxLength={120} value={f.paymentTerms} onChange={set("paymentTerms")} />
        <TextArea label={t("fields.notes")} className="sm:col-span-2" maxLength={500} rows={2} value={f.notes} onChange={set("notes")} />
        {message ? <div className="sm:col-span-2"><Alert tone="danger">{message}</Alert></div> : null}
      </form>
    </Dialog>
  );
}

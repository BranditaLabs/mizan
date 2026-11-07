"use client";

import { findRegion, rolesWith } from "@mizan/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Bdi } from "@/components/Bdi";
import { ProductImage } from "@/components/catalog/ProductImage";
import { Alert } from "@/components/ui/Alert";
import { Button, IconButton } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { ErrorState } from "@/components/ui/QueryState";
import { useToast } from "@/components/ui/Toast";
import { MoneyText } from "@/components/ui/Values";
import { ApiError, ok, type Schemas } from "@/lib/api/client";
import { problemText } from "@/lib/api/query";
import { useSession } from "@/lib/session";
import { addressBody, addressProblems, AddressFields, type AddressValue } from "./AddressFields";

type Order = Schemas["OrderDetail"];
const EDITORS = rolesWith("orders.create");
const BEFORE_COURIER = new Set(["new", "pending_confirmation", "confirmed"]);
const STORES = new Set(["shopify", "woocommerce"]);
const AMOUNT = /^\d{1,9}(\.\d{1,2})?$/;
/** Why the API refused an edit, said in the person's language. */
const EDIT_ERRORS = new Set(["not_editable", "edit_in_progress", "price_in_store", "not_in_store", "no_items", "no_change", "refund_first", "paid_order", "total_invalid", "currency_mismatch", "pii_redacted"]);

/** O3: whether this person can change this order now (before the courier has it, no edit on its way). */
export function canEditOrder(o: Order, role: string | undefined) {
  const live = o.shipments.some((s) => s.booking !== "failed" && s.status !== "cancelled");
  const channel = !o.store.connectionId || STORES.has(o.store.provider ?? "");
  return EDITORS.has(role ?? "") && BEFORE_COURIER.has(o.status) && !live && channel && o.edit?.status !== "sending";
}

/** O3: an edit on its way to the store, or one the store refused (with its words). */
export function EditBanner({ order: o }: { order: Order }) {
  const t = useTranslations("orders.edit");
  const store = o.store.provider === "woocommerce" ? "WooCommerce" : "Shopify";
  if (o.edit?.status === "sending") return <Alert tone="info">{t("sending", { store })}</Alert>;
  if (o.edit?.status === "failed") return <Alert tone="danger">{t("failed", { store, message: o.edit.message ?? "" })}</Alert>;
  return null;
}

interface Row { lineId: string; title: string; sku: string | null; picture: Order["lines"][number]["picture"]; quantity: string; price: string; was: { quantity: number; price: string } }
interface Added { variantId: string; title: string; picture: Order["lines"][number]["picture"]; quantity: string }

/** O3: the order's items, the delivery fee and the address, changed in one go. */
export function EditOrderButton({ order: o }: { order: Order }) {
  const t = useTranslations("orders.edit");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" icon="edit" onClick={() => setOpen(true)}>{t("open")}</Button>
      {open ? <EditOrderDialog order={o} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function EditOrderDialog({ order: o, onClose }: { order: Order; onClose(): void }) {
  const t = useTranslations("orders.edit");
  const tpr = useTranslations("problems");
  const { api, user, store } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const shopify = o.store.provider === "shopify";
  const [rows, setRows] = useState<Row[]>(() => o.lines.map((l) => ({
    lineId: l.id, title: l.title, sku: l.sku, picture: l.picture, quantity: String(l.quantity), price: l.unitPrice.amount, was: { quantity: l.quantity, price: l.unitPrice.amount },
  })));
  const [added, setAdded] = useState<Added[]>([]);
  const [fee, setFee] = useState(o.shipping.amount);
  const [moving, setMoving] = useState(false);
  const country = store?.country ?? "EG";
  // The governorate as the list knows it (the store may have sent a code or the Arabic name).
  const [address, setAddress] = useState<AddressValue>(() => ({
    line1: "", line2: "", locationText: "", city: o.area.city ?? "",
    province: findRegion(country, o.area.province ?? "", o.area.city ?? "")?.en ?? o.area.province ?? "",
  }));

  const products = useQuery({
    queryKey: ["order-products", user?.uid ?? "", store?.tenantId ?? ""],
    queryFn: () => ok(api.GET("/v1/orders/products")),
    enabled: Boolean(store),
  });
  const options = (products.data?.data ?? []).map((p) => ({
    value: p.variantId, label: p.title, hint: p.sku ?? undefined,
    media: <ProductImage image={p.picture ? { ...p.picture, width: null, height: null } : null} alt="" size={28} />,
  }));
  const add = (variantId: string) => {
    const p = products.data?.data.find((x) => x.variantId === variantId);
    if (!p || added.some((a) => a.variantId === variantId)) return;
    setAdded((xs) => [...xs, { variantId, title: p.title, picture: p.picture, quantity: "1" }]);
  };

  const qty = (v: string) => (/^\d{1,3}$/.test(v) ? Number(v) : NaN);
  const body = {
    lines: rows.flatMap((r) => {
      const q = qty(r.quantity);
      const priced = !shopify && r.price !== r.was.price;
      return q === r.was.quantity && !priced ? [] : [{ lineId: r.lineId, quantity: q, ...(priced ? { unitPrice: r.price } : {}) }];
    }),
    add: added.map((a) => ({ variantId: a.variantId, quantity: qty(a.quantity) })),
    ...(fee !== o.shipping.amount ? { shipping: fee } : {}),
    ...(moving ? { address: addressBody(address) } : {}),
  };
  const invalid = [...rows.map((r) => r.quantity), ...added.map((a) => a.quantity)].some((q) => Number.isNaN(qty(q)))
    || added.some((a) => qty(a.quantity) < 1) || rows.some((r) => !AMOUNT.test(r.price)) || !AMOUNT.test(fee)
    || (moving && Object.keys(addressProblems(address, country)).length > 0);
  const empty = !body.lines.length && !body.add.length && !("shipping" in body) && !moving;

  const save = useMutation({
    mutationFn: () => ok(api.PATCH("/v1/orders/{id}", { params: { path: { id: o.id } }, body })),
    onSuccess: async (r) => {
      await Promise.all([qc.invalidateQueries({ queryKey: ["order"] }), qc.invalidateQueries({ queryKey: ["orders"] }), qc.invalidateQueries({ queryKey: ["profit"] })]);
      toast.event({ type: r.status === "applied" ? "order.edited" : null, message: r.status === "applied" ? t("applied") : t("sent", { store: o.store.provider === "woocommerce" ? "WooCommerce" : "Shopify" }) });
      onClose();
    },
    meta: { toast: false },
  });

  return (
    <Dialog open onClose={onClose} title={t("title", { number: o.number })} description={o.store.connectionId ? t("storeNote", { store: shopify ? "Shopify" : "WooCommerce" }) : t("manualNote")} className="max-w-2xl"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>{t("cancel")}</Button>
          <Button busy={save.isPending} disabled={invalid || empty} onClick={() => save.mutate()}>{t("save")}</Button>
        </>
      )}>
      <div className="flex flex-col gap-5" data-testid="edit-order">
        <section className="flex flex-col gap-3">
          <h3 className="text-body font-medium">{t("items")}</h3>
          {rows.map((r, i) => (
            <div key={r.lineId} className="flex flex-wrap items-end gap-3">
              <div className="flex min-w-48 flex-1 items-center gap-3">
                <ProductImage image={r.picture ? { ...r.picture, width: null, height: null } : null} alt="" size={36} />
                <span className="min-w-0">
                  <span className={`block text-body-sm ${qty(r.quantity) === 0 ? "text-text-3 line-through" : ""}`}>{r.title}</span>
                  {r.sku ? <span className="text-caption text-text-3"><Bdi code>{r.sku}</Bdi></span> : null}
                </span>
              </div>
              <Field label={t("quantity")} ltr inputMode="numeric" className="w-24" value={r.quantity}
                onChange={(e) => setRows((xs) => xs.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
              {shopify ? null : (
                <Field label={t("price")} ltr inputMode="decimal" className="w-32" value={r.price}
                  onChange={(e) => setRows((xs) => xs.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} />
              )}
              <IconButton icon="delete" label={t("remove", { item: r.title })} onClick={() => setRows((xs) => xs.map((x, j) => (j === i ? { ...x, quantity: "0" } : x)))} />
            </div>
          ))}
          {added.map((a, i) => (
            <div key={a.variantId} className="flex flex-wrap items-end gap-3">
              <div className="flex min-w-48 flex-1 items-center gap-3">
                <ProductImage image={a.picture ? { ...a.picture, width: null, height: null } : null} alt="" size={36} />
                <span className="text-body-sm">{a.title}<span className="ms-2 text-caption text-text-3">{t("new")}</span></span>
              </div>
              <Field label={t("quantity")} ltr inputMode="numeric" className="w-24" value={a.quantity}
                onChange={(e) => setAdded((xs) => xs.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
              <IconButton icon="close" label={t("remove", { item: a.title })} onClick={() => setAdded((xs) => xs.filter((_, j) => j !== i))} />
            </div>
          ))}
          {/* The catalogue could not be loaded: say so, not "no products". */}
          {products.isError && !products.data ? <ErrorState compact className="rounded-md border border-line" error={products.error} onRetry={() => void products.refetch()} retrying={products.isRefetching} />
            : <Combobox label={t("add")} options={options} value={null} onChange={add} emptyText={t("noProducts")} placeholder={t("addPlaceholder")} />}
          {shopify ? <p className="text-caption text-text-3">{t("shopifyPrices")}</p> : null}
        </section>

        <section className="flex flex-col gap-3">
          <Field label={t("fee")} ltr inputMode="decimal" className="w-40" value={fee} onChange={(e) => setFee(e.target.value)}
            hint={<>{t("feeWas")} <MoneyText money={o.shipping} /></>} />
        </section>

        <section className="flex flex-col gap-3">
          {moving ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2"><AddressFields value={address} onChange={setAddress} country={country} showErrors={address.line1.trim().length > 0} /></div>
              <div className="sm:col-span-2"><Button size="sm" variant="ghost" onClick={() => setMoving(false)}>{t("keepAddress")}</Button></div>
            </div>
          ) : <div><Button size="sm" variant="secondary" icon="pin" onClick={() => setMoving(true)}>{t("changeAddress")}</Button></div>}
        </section>

        {save.isError ? <Alert tone="danger">{save.error instanceof ApiError && save.error.code && EDIT_ERRORS.has(save.error.code) ? t(`errors.${save.error.code as "no_items"}`) : problemText(save.error, tpr)}</Alert> : null}
      </div>
    </Dialog>
  );
}

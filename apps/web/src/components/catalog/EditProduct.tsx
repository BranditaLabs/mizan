"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toAsciiDigits } from "@mizan/shared";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button, IconButton } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Select, TextArea } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { ApiError, ok, type Schemas } from "@/lib/api/client";
import { problemText } from "@/lib/api/query";
import { useSession } from "@/lib/session";
import { ProductImage } from "./ProductImage";

type Product = Schemas["ProductDetail"];
type Body = Schemas["ProductUpdate"];
export const PRODUCT_EDITORS = new Set(["owner", "admin", "ops_manager"]);
const AMOUNT = /^\d{1,9}(\.\d{1,3})?$/;
/** An amount as typed, in Western digits with a dot (٩٩٠٫٥ → 990.5). */
const decimal = (v: string) => toAsciiDigits(v).replace(/٫/g, ".").trim();
/** Why the API refused an edit, in the person's language. */
const EDIT_ERRORS = new Set(["field_not_in_store", "images_mismatch", "images_not_in_store", "compare_at_low", "unknown_variant", "price_decimals"]);

interface PriceRow { id: string; label: string; price: string; compareAt: string; was: { price: string; compareAt: string } }

/**
 * P2: the product's own fields, its pictures' order and the main one, and its prices, edited in
 * Mizan and sent to the store. Only what changed is sent. Vendor and type are Shopify's (WooCommerce
 * has none); prices set here are Mizan's from then on.
 */
export function EditProduct({ product: p, onClose }: { product: Product; onClose(): void }) {
  const t = useTranslations("products.editProduct");
  const tpr = useTranslations("problems");
  const { api } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const woo = p.store?.provider === "woocommerce";
  const [title, setTitle] = useState(p.title);
  const [status, setStatus] = useState(p.status);
  const [vendor, setVendor] = useState(p.vendor ?? "");
  const [type, setType] = useState(p.productType ?? "");
  const [tags, setTags] = useState(p.tags.join(", "));
  const [description, setDescription] = useState(p.description);
  // The main picture first, as the stores keep it.
  const [images, setImages] = useState(() => {
    const main = p.images.find((i) => i.isMain);
    return main ? [main, ...p.images.filter((i) => i.id !== main.id)] : p.images;
  });
  const [prices, setPrices] = useState<PriceRow[]>(() => p.variants.map((v) => {
    const was = { price: v.price.amount, compareAt: v.compareAt?.amount ?? "" };
    return { id: v.id, label: v.options.length ? v.options.map((o) => o.value).join(" / ") : v.title ?? v.sku, ...was, was };
  }));

  const move = (i: number, by: -1 | 1) => setImages((xs) => {
    const next = [...xs];
    const [x] = next.splice(i, 1);
    next.splice(i + by, 0, x!);
    return next;
  });
  const tagList = [...new Set(tags.split(/[,،]/).map((x) => x.trim()).filter(Boolean))];
  const changed = (r: PriceRow) => decimal(r.price) !== r.was.price || decimal(r.compareAt) !== r.was.compareAt;
  const changedPrices = prices.filter(changed);
  const orderChanged = images.map((i) => i.id).join() !== p.images.map((i) => i.id).join();
  const body: Body = {
    ...(title.trim() !== p.title ? { title: title.trim() } : {}),
    ...(status !== p.status ? { status } : {}),
    ...(!woo && vendor.trim() !== (p.vendor ?? "") ? { vendor: vendor.trim() } : {}),
    ...(!woo && type.trim() !== (p.productType ?? "") ? { productType: type.trim() } : {}),
    ...(tagList.join("\n") !== p.tags.join("\n") ? { tags: tagList } : {}),
    ...(description !== p.description ? { description } : {}),
    ...(orderChanged ? { images: { order: images.map((i) => i.id) } } : {}),
    ...(changedPrices.length ? {
      variants: changedPrices.map((r) => ({ id: r.id, price: decimal(r.price), compareAtPrice: decimal(r.compareAt) ? decimal(r.compareAt) : null })),
    } : {}),
  };
  // Only rows the person changed are checked: a store's odd compare-at price never blocks other edits.
  const priceError = (r: PriceRow) => (changed(r) && !AMOUNT.test(decimal(r.price)) ? t("priceInvalid") : null);
  const compareError = (r: PriceRow) => (changed(r) && decimal(r.compareAt) && (!AMOUNT.test(decimal(r.compareAt)) || Number(decimal(r.compareAt)) <= Number(decimal(r.price))) ? t("compareAtLow") : null);
  const invalid = !title.trim() || prices.some((r) => priceError(r) || compareError(r));
  const empty = Object.keys(body).length === 0;

  const save = useMutation({
    mutationFn: () => ok(api.PATCH("/v1/products/{id}", { params: { path: { id: p.id } }, body })),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["products"] });
      toast({ message: p.store ? t("savedStore", { store: woo ? "WooCommerce" : "Shopify" }) : t("saved") });
      onClose();
    },
    meta: { toast: false },
  });

  return (
    <Dialog open onClose={onClose} title={t("title")} description={p.store ? t("storeNote", { store: woo ? "WooCommerce" : "Shopify" }) : undefined} className="max-w-2xl"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>{t("cancel")}</Button>
          <Button busy={save.isPending} disabled={invalid || empty} onClick={() => save.mutate()}>{t("save")}</Button>
        </>
      )}>
      <div className="flex flex-col gap-5" data-testid="edit-product">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("name")} className="sm:col-span-2" value={title} maxLength={255} onChange={(e) => setTitle(e.target.value)} error={title.trim() ? null : t("nameNeeded")} />
          <Select label={t("status")} value={status} onChange={(e) => setStatus(e.target.value as Product["status"])}>
            {(["active", "draft", "archived"] as const).map((s) => <option key={s} value={s}>{t(`statusName.${s}`)}</option>)}
          </Select>
          <Field label={t("tags")} hint={t("tagsHint")} value={tags} onChange={(e) => setTags(e.target.value)} />
          {woo ? null : (
            <>
              <Field label={t("vendor")} value={vendor} maxLength={255} onChange={(e) => setVendor(e.target.value)} />
              <Field label={t("type")} value={type} maxLength={255} onChange={(e) => setType(e.target.value)} />
            </>
          )}
          <TextArea label={t("description")} hint={t("descriptionHint")} className="sm:col-span-2" rows={5} value={description} maxLength={20000} onChange={(e) => setDescription(e.target.value)} />
        </div>

        {images.length > 1 ? (
          <section className="flex flex-col gap-2">
            <h3 className="text-body font-medium">{t("pictures")}</h3>
            <p className="text-caption text-text-3">{t("picturesHint")}</p>
            <ol className="flex flex-col gap-2">
              {images.map((img, i) => (
                <li key={img.id} className="flex items-center gap-3">
                  <ProductImage image={img} alt={img.alt ?? p.title} size={48} />
                  <span className="flex-1 text-body-sm">{i === 0 ? t("main") : t("position", { n: i + 1 })}</span>
                  {i > 0 ? <Button size="sm" variant="ghost" onClick={() => setImages((xs) => [xs[i]!, ...xs.filter((_, j) => j !== i)])}>{t("makeMain")}</Button> : null}
                  <IconButton icon="arrow-up" size="sm" label={t("up")} disabled={i === 0} onClick={() => move(i, -1)} />
                  <IconButton icon="arrow-down" size="sm" label={t("down")} disabled={i === images.length - 1} onClick={() => move(i, 1)} />
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        <section className="flex flex-col gap-2">
          <h3 className="text-body font-medium">{t("prices")}</h3>
          <p className="text-caption text-text-3">{t("pricesHint")}</p>
          {prices.map((r, i) => (
            <div key={r.id} className="flex flex-wrap items-end gap-3">
              <span className="min-w-32 flex-1 text-body-sm">{r.label}</span>
              <Field label={t("price")} ltr inputMode="decimal" className="w-32" value={r.price} error={priceError(r)}
                onChange={(e) => setPrices((xs) => xs.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} />
              <Field label={t("compareAt")} ltr inputMode="decimal" className="w-32" value={r.compareAt} error={compareError(r)}
                onChange={(e) => setPrices((xs) => xs.map((x, j) => (j === i ? { ...x, compareAt: e.target.value } : x)))} />
            </div>
          ))}
        </section>

        {save.isError ? <Alert tone="danger">{save.error instanceof ApiError && EDIT_ERRORS.has(save.error.code) ? t(`errors.${save.error.code as "images_mismatch"}`) : problemText(save.error, tpr)}</Alert> : null}
      </div>
    </Dialog>
  );
}

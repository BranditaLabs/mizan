"use client";

import { toAsciiDigits } from "@mizan/shared";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button, IconButton } from "@/components/ui/Button";
import { Field, Select, TextArea } from "@/components/ui/Field";
import { Card } from "@/components/ui/Surface";
import { Link, useRouter } from "@/i18n/navigation";
import { ApiError, ok, type Schemas } from "@/lib/api/client";
import { problemText } from "@/lib/api/query";
import { useSession } from "@/lib/session";
import { PRODUCT_EDITORS } from "./EditProduct";

type Body = Schemas["NewProduct"];
interface Option { name: string; values: string }
interface Row { key: string; options: Array<{ name: string; value: string }>; sku: string; price: string; compareAt: string; skuTouched: boolean; priceTouched: boolean }
const AMOUNT = /^\d{1,9}(\.\d{1,3})?$/;
const SKU = /^[\x21-\x7E]{1,64}$/;
const ERRORS = new Set(["sku_taken", "barcode_taken", "variants_invalid", "options_invalid", "compare_at_low", "price_decimals"]);
const decimal = (v: string) => toAsciiDigits(v).replace(/٫/g, ".").trim();
const valuesOf = (o: Option) => [...new Set(o.values.split(/[,،]/).map((v) => v.trim()).filter(Boolean))];
/** "Black / XL" → "BLACK-XL": a readable SKU part in Latin letters; other scripts give the value's position. */
const part = (value: string, index: number) => value.normalize("NFKD").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "") || String(index + 1);

/**
 * P3: a product made in Mizan — for a store without a channel yet, or to publish to one later. Its
 * options (up to three) make its variants, one per combination, each with a SKU (from a prefix,
 * editable) and a price (one for all, editable).
 */
export function NewProduct() {
  const t = useTranslations("products.newProduct");
  const tpr = useTranslations("problems");
  const { api, store } = useSession();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<Body["status"]>("draft");
  const [description, setDescription] = useState("");
  const [vendor, setVendor] = useState("");
  const [type, setType] = useState("");
  const [tags, setTags] = useState("");
  const [options, setOptions] = useState<Option[]>([]);
  const [prefix, setPrefix] = useState("");
  const [price, setPrice] = useState("");
  const [rows, setRows] = useState<Row[]>([]);

  // One variant per combination of the options' values; what the person typed for one is kept.
  const combos = options.map(valuesOf).filter((v) => v.length).length === options.length
    ? options.reduce<Array<Array<{ name: string; value: string; index: number }>>>((acc, o) => acc.flatMap((c) => valuesOf(o).map((v, i) => [...c, { name: o.name.trim(), value: v, index: i }])), [[]])
    : [];
  const shown: Row[] = combos.map((combo) => {
    const key = combo.map((c) => `${c.name}=${c.value}`).join("|");
    const kept = rows.find((r) => r.key === key);
    const sku = [prefix.trim().toUpperCase(), ...combo.map((c) => part(c.value, c.index))].filter(Boolean).join("-");
    return {
      key, options: combo.map(({ name, value }) => ({ name, value })),
      sku: kept?.skuTouched ? kept.sku : sku, price: kept?.priceTouched ? kept.price : decimal(price), compareAt: kept?.compareAt ?? "",
      skuTouched: kept?.skuTouched ?? false, priceTouched: kept?.priceTouched ?? false,
    };
  });
  const setRow = (key: string, patch: Partial<Row>) => setRows(() => shown.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const optionNames = options.map((o) => o.name.trim().toLowerCase());
  const optionError = (o: Option) => (!o.name.trim() ? t("optionName") : optionNames.filter((n) => n === o.name.trim().toLowerCase()).length > 1 ? t("optionTwice") : !valuesOf(o).length ? t("optionValues") : null);
  const rowError = (r: Row) => (!SKU.test(r.sku) ? t("skuInvalid") : !AMOUNT.test(decimal(r.price)) ? t("priceInvalid")
    : decimal(r.compareAt) && (!AMOUNT.test(decimal(r.compareAt)) || Number(decimal(r.compareAt)) <= Number(decimal(r.price))) ? t("compareAtLow") : null);
  const skus = shown.map((r) => r.sku);
  const invalid = !title.trim() || options.some((o) => optionError(o)) || shown.some((r) => rowError(r)) || new Set(skus).size !== skus.length || !shown.length || shown.length > 100;

  const body: Body = {
    title: title.trim(), status, tags: [...new Set(tags.split(/[,،]/).map((x) => x.trim()).filter(Boolean))],
    ...(description.trim() ? { description } : {}), ...(vendor.trim() ? { vendor: vendor.trim() } : {}), ...(type.trim() ? { productType: type.trim() } : {}),
    options: options.map((o) => ({ name: o.name.trim(), values: valuesOf(o) })),
    variants: shown.map((r) => ({ options: r.options, sku: r.sku, price: decimal(r.price), ...(decimal(r.compareAt) ? { compareAtPrice: decimal(r.compareAt) } : {}) })),
  };
  const create = useMutation({
    mutationFn: () => ok(api.POST("/v1/products", { body })),
    onSuccess: (r) => router.push(`/products/${r.id}`),
    meta: { toast: false },
  });

  if (!PRODUCT_EDITORS.has(store?.role ?? "")) return null;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 pt-6 pb-14 md:px-6">
      <header>
        <Link href="/products" className="text-body-sm text-text-2 hover:text-text">{t("back")}</Link>
        <h1 className="mt-2 font-display text-heading-lg">{t("title")}</h1>
        <p className="mt-1 text-body-sm text-text-2">{t("subtitle")}</p>
      </header>

      <Card title={t("details")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("name")} className="sm:col-span-2" value={title} maxLength={255} onChange={(e) => setTitle(e.target.value)} />
          <Select label={t("status")} value={status} onChange={(e) => setStatus(e.target.value as Body["status"])}>
            {(["draft", "active", "archived"] as const).map((s) => <option key={s} value={s}>{t(`statusName.${s}`)}</option>)}
          </Select>
          <Field label={t("tags")} hint={t("tagsHint")} value={tags} onChange={(e) => setTags(e.target.value)} />
          <Field label={t("vendor")} value={vendor} maxLength={255} onChange={(e) => setVendor(e.target.value)} />
          <Field label={t("type")} value={type} maxLength={255} onChange={(e) => setType(e.target.value)} />
          <TextArea label={t("description")} hint={t("descriptionHint")} className="sm:col-span-2" rows={4} value={description} maxLength={20000} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </Card>

      <Card title={t("options")}>
        <div className="flex flex-col gap-3">
          <p className="text-body-sm text-text-2">{t("optionsHint")}</p>
          {options.map((o, i) => (
            <div key={i} className="flex flex-wrap items-end gap-3">
              <Field label={t("optionNameLabel")} className="w-40" value={o.name} maxLength={60} placeholder={t("optionNamePlaceholder")}
                onChange={(e) => setOptions((xs) => xs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} error={o.name || o.values ? optionError(o) : null} />
              <Field label={t("optionValuesLabel")} className="min-w-48 flex-1" value={o.values} placeholder={t("optionValuesPlaceholder")}
                onChange={(e) => setOptions((xs) => xs.map((x, j) => (j === i ? { ...x, values: e.target.value } : x)))} />
              <IconButton icon="delete" label={t("removeOption", { name: o.name || String(i + 1) })} onClick={() => setOptions((xs) => xs.filter((_, j) => j !== i))} />
            </div>
          ))}
          {options.length < 3 ? <div><Button size="sm" variant="secondary" icon="add" onClick={() => setOptions((xs) => [...xs, { name: "", values: "" }])}>{t("addOption")}</Button></div> : null}
        </div>
      </Card>

      <Card title={t("variants")}>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-3">
            <Field label={t("skuPrefix")} hint={t("skuPrefixHint")} ltr className="w-40" value={prefix} maxLength={30} onChange={(e) => setPrefix(e.target.value)} />
            <Field label={t("price")} hint={t("priceHint")} ltr inputMode="decimal" className="w-40" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          {shown.length > 100 ? <Alert tone="warning">{t("tooMany")}</Alert> : null}
          <ul className="flex flex-col divide-y divide-line" data-testid="new-variants">
            {shown.map((r) => (
              <li key={r.key} className="flex flex-wrap items-end gap-3 py-2">
                <span className="min-w-24 flex-1 text-body-sm">{r.options.length ? r.options.map((o) => o.value).join(" / ") : t("single")}</span>
                <Field label={t("sku")} ltr className="w-44" value={r.sku} onChange={(e) => setRow(r.key, { sku: e.target.value, skuTouched: true })} />
                <Field label={t("variantPrice")} ltr inputMode="decimal" className="w-28" value={r.price} onChange={(e) => setRow(r.key, { price: e.target.value, priceTouched: true })} />
                <Field label={t("compareAt")} ltr inputMode="decimal" className="w-28" value={r.compareAt} onChange={(e) => setRow(r.key, { compareAt: e.target.value })} error={r.sku && r.price ? rowError(r) : null} />
              </li>
            ))}
          </ul>
          {new Set(skus).size !== skus.length ? <Alert tone="warning">{t("skuTwice")}</Alert> : null}
        </div>
      </Card>

      {create.isError ? <Alert tone="danger">{create.error instanceof ApiError && ERRORS.has(create.error.code) ? t(`errors.${create.error.code as "sku_taken"}`, { detail: create.error.detail ?? "" }) : problemText(create.error, tpr)}</Alert> : null}
      <div className="flex justify-end gap-2">
        <Link href="/products" className="mz-btn mz-btn--secondary">{t("cancel")}</Link>
        <Button busy={create.isPending} disabled={invalid} onClick={() => create.mutate()}>{t("create")}</Button>
      </div>
    </div>
  );
}

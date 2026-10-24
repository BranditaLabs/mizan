"use client";

import { fromMinor, toMinor, type Money } from "@mizan/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button, IconButton } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { Field, Select } from "@/components/ui/Field";
import { Card, EmptyState } from "@/components/ui/Surface";
import { useToast } from "@/components/ui/Toast";
import { MoneyText } from "@/components/ui/Values";
import { useRouter } from "@/i18n/navigation";
import { ok, type Schemas } from "@/lib/api/client";
import { useSession } from "@/lib/session";

type NewOrderBody = Schemas["NewOrder"];
type Mode = NewOrderBody["payment"]["mode"];
type Method = NonNullable<NewOrderBody["payment"]["method"]>;
interface Line { key: number; variantId?: string; title: string; sku?: string | null; quantity: number; unitPrice: string; currency: string }

const SOURCES: readonly NewOrderBody["source"][] = ["phone", "whatsapp", "instagram", "facebook", "tiktok", "walk_in", "other"];
const MODES: readonly Mode[] = ["cod", "partial", "prepaid", "bank_transfer"];
const METHODS: readonly Method[] = ["wallet", "instapay", "card"];
const CREATORS = new Set(["owner", "admin", "ops_manager", "agent"]);
const AMOUNT = /^\d{1,9}(\.\d{1,2})?$/;

/**
 * New order (M1, E5-5): an order taken on the phone, in WhatsApp or Instagram, or in person.
 * Customer, address, items from the catalogue (or a one-off item), shipping and discount, and how
 * the customer pays; the summary shows what the courier will collect. Created, it is an order like
 * any other: confirmation, risk and profit apply.
 */
export function NewOrder() {
  const t = useTranslations("newOrder");
  const { api, user, store } = useSession();
  const router = useRouter();
  const toast = useToast();
  const allowed = CREATORS.has(store?.role ?? "");
  const currency = store?.baseCurrency ?? "EGP";

  const [source, setSource] = useState<NewOrderBody["source"]>("phone");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [pick, setPick] = useState<string | null>(null);
  const [custom, setCustom] = useState({ title: "", price: "" });
  const [shipping, setShipping] = useState("0");
  const [discount, setDiscount] = useState("0");
  const [mode, setMode] = useState<Mode>("cod");
  const [method, setMethod] = useState<Method>("wallet");
  const [paid, setPaid] = useState("");
  const [received, setReceived] = useState(false);
  const [tried, setTried] = useState(false);

  const products = useQuery({
    queryKey: ["orderProducts", user?.uid ?? "", store?.tenantId ?? ""],
    queryFn: () => ok(api.GET("/v1/orders/products")),
    enabled: Boolean(store) && allowed,
  });
  const create = useMutation({
    mutationFn: (body: NewOrderBody) => ok(api.POST("/v1/orders", { body })),
    onSuccess: (r) => { toast({ message: t("created", { number: r.number }) }); router.push(`/orders/${r.id}`); },
  });

  if (!allowed) return <div className="mx-auto max-w-[860px] px-4 pt-6 md:px-6"><div className="mz-card"><EmptyState icon="locked" title={t("notAllowed.title")} body={t("notAllowed.body")} /></div></div>;

  const cur = lines[0]?.currency ?? currency;
  const minor = (v: string) => (AMOUNT.test(v.trim()) ? toMinor({ amount: v.trim(), currency: cur }) : null);
  const subtotal = lines.reduce((a, l) => a + (minor(l.unitPrice) ?? 0n) * BigInt(l.quantity), 0n);
  const total = subtotal + (minor(shipping) ?? 0n) - (minor(discount) ?? 0n);
  const paidMinor = mode === "prepaid" ? total : mode === "partial" ? (minor(paid) ?? 0n) : mode === "bank_transfer" && received ? total : 0n;
  const collect = mode === "bank_transfer" ? 0n : total - paidMinor;
  const m = (x: bigint): Money => fromMinor(x < 0n ? 0n : x, cur);

  const errors = {
    name: name.trim().length < 2 ? t("errors.name") : null,
    phone: phone.trim().length < 6 ? t("errors.phone") : null,
    line1: line1.trim().length < 3 ? t("errors.line1") : null,
    city: city.trim().length < 2 ? t("errors.city") : null,
    lines: lines.length === 0 ? t("errors.lines") : lines.some((l) => minor(l.unitPrice) === null || l.quantity < 1) ? t("errors.linePrice") : null,
    shipping: minor(shipping) === null ? t("errors.amount") : null,
    discount: minor(discount) === null ? t("errors.amount") : total <= 0n && lines.length ? t("errors.total") : null,
    paid: mode === "partial" && (minor(paid) === null || paidMinor <= 0n || paidMinor >= total) ? t("errors.deposit") : null,
  };
  const valid = Object.values(errors).every((e) => e === null);
  const show = (e: string | null) => (tried ? e : null);

  const options = (products.data?.data ?? []).map((p) => ({ value: p.variantId, label: p.title, hint: p.sku ?? undefined }));
  const addProduct = (variantId: string) => {
    const p = products.data?.data.find((x) => x.variantId === variantId);
    if (!p) return;
    setLines((ls) => {
      const same = ls.find((l) => l.variantId === variantId);
      if (same) return ls.map((l) => (l === same ? { ...l, quantity: l.quantity + 1 } : l));
      return [...ls, { key: Date.now(), variantId, title: p.title, sku: p.sku, quantity: 1, unitPrice: p.price.amount, currency: p.price.currency }];
    });
    setPick(null);
  };
  const addCustom = () => {
    if (!custom.title.trim() || minor(custom.price) === null) return;
    setLines((ls) => [...ls, { key: Date.now(), title: custom.title.trim(), quantity: 1, unitPrice: custom.price.trim(), currency: cur }]);
    setCustom({ title: "", price: "" });
  };
  const setLine = (key: number, next: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...next } : l)));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!valid) return;
    create.mutate({
      source, customer: { name: name.trim(), phone: phone.trim() },
      address: { line1: line1.trim(), ...(line2.trim() ? { line2: line2.trim() } : {}), city: city.trim() },
      lines: lines.map((l) => (l.variantId ? { variantId: l.variantId, quantity: l.quantity, unitPrice: l.unitPrice } : { title: l.title, quantity: l.quantity, unitPrice: l.unitPrice })),
      shipping: shipping.trim(), discount: discount.trim(),
      payment: {
        mode, ...(mode !== "cod" ? { method } : {}),
        ...(mode === "partial" ? { paid: paid.trim() } : mode === "bank_transfer" && received ? { paid: fromMinor(total, cur).amount } : {}),
      },
    });
  };

  return (
    <form onSubmit={submit} noValidate className="mx-auto flex max-w-[1100px] flex-col gap-5 px-4 pt-6 pb-14 md:px-6" data-testid="new-order">
      <header>
        <h1 className="font-display text-heading-lg">{t("title")}</h1>
        <p className="mt-1 text-body-sm text-text-2">{t("subtitle")}</p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1fr_340px] lg:items-start">
        <div className="flex flex-col gap-5">
          <Card title={t("customer.title")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("customer.name")} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} error={show(errors.name)} />
              <Field label={t("customer.phone")} ltr type="tel" inputMode="tel" autoComplete="off" placeholder={t("customer.phonePlaceholder")} value={phone} onChange={(e) => setPhone(e.target.value)} error={show(errors.phone)} />
              <Select label={t("customer.source")} value={source} onChange={(e) => setSource(e.target.value as NewOrderBody["source"])}>
                {SOURCES.map((s) => <option key={s} value={s}>{t(`source.${s}`)}</option>)}
              </Select>
            </div>
          </Card>

          <Card title={t("address.title")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("address.line1")} className="sm:col-span-2" value={line1} onChange={(e) => setLine1(e.target.value)} error={show(errors.line1)} />
              <Field label={t("address.line2")} hint={t("address.line2Hint")} value={line2} onChange={(e) => setLine2(e.target.value)} />
              <Field label={t("address.city")} value={city} onChange={(e) => setCity(e.target.value)} error={show(errors.city)} />
            </div>
          </Card>

          <Card title={t("items.title")}>
            <div className="flex flex-col gap-4">
              <Combobox label={t("items.pick")} options={options} value={pick} onChange={addProduct} emptyText={t("items.noProducts")} placeholder={t("items.pickPlaceholder")} />
              {lines.length ? (
                <ul className="flex flex-col divide-y divide-line" data-testid="order-lines">
                  {lines.map((l) => (
                    <li key={l.key} className="flex flex-wrap items-end gap-3 py-3">
                      <div className="min-w-40 flex-1">
                        <p className="text-body-sm font-medium">{l.title}</p>
                        {l.sku ? <p className="text-caption text-text-3"><bdi>{l.sku}</bdi></p> : null}
                      </div>
                      <Field label={t("items.quantity")} ltr type="number" inputMode="numeric" min={1} max={999} className="w-24" value={String(l.quantity)}
                        onChange={(e) => setLine(l.key, { quantity: Math.max(1, Math.min(999, Math.round(Number(e.target.value) || 1))) })} />
                      <Field label={t("items.price")} ltr inputMode="decimal" className="w-32" value={l.unitPrice} onChange={(e) => setLine(l.key, { unitPrice: e.target.value })}
                        error={minor(l.unitPrice) === null ? t("errors.amount") : null} />
                      <IconButton icon="delete" label={t("items.remove", { title: l.title })} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} />
                    </li>
                  ))}
                </ul>
              ) : <p className="text-body-sm text-text-2">{t("items.empty")}</p>}
              {show(errors.lines) ? <p className="text-body-sm text-danger-text" role="alert">{errors.lines}</p> : null}
              <details className="text-body-sm">
                <summary className="cursor-pointer text-text-2">{t("items.custom")}</summary>
                <div className="mt-3 flex flex-wrap items-end gap-3">
                  <Field label={t("items.customTitle")} className="min-w-48 flex-1" value={custom.title} onChange={(e) => setCustom({ ...custom, title: e.target.value })} />
                  <Field label={t("items.price")} ltr inputMode="decimal" className="w-32" value={custom.price} onChange={(e) => setCustom({ ...custom, price: e.target.value })} />
                  <Button type="button" size="sm" variant="secondary" icon="add" disabled={!custom.title.trim() || minor(custom.price) === null} onClick={addCustom}>{t("items.addCustom")}</Button>
                </div>
              </details>
            </div>
          </Card>

          <Card title={t("payment.title")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Select label={t("payment.mode")} value={mode} onChange={(e) => setMode(e.target.value as Mode)} className="sm:col-span-2">
                {MODES.map((x) => <option key={x} value={x}>{t(`mode.${x}`)}</option>)}
              </Select>
              {mode !== "cod" ? (
                <Select label={t("payment.method")} value={method} onChange={(e) => setMethod(e.target.value as Method)}>
                  {METHODS.map((x) => <option key={x} value={x}>{t(`method.${x}`)}</option>)}
                </Select>
              ) : null}
              {mode === "partial" ? <Field label={t("payment.deposit")} ltr inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value)} error={show(errors.paid)} /> : null}
              {mode === "bank_transfer" ? (
                <Select label={t("payment.transfer")} value={received ? "yes" : "no"} onChange={(e) => setReceived(e.target.value === "yes")}>
                  <option value="no">{t("payment.waiting")}</option>
                  <option value="yes">{t("payment.received")}</option>
                </Select>
              ) : null}
              <Field label={t("payment.shipping")} ltr inputMode="decimal" value={shipping} onChange={(e) => setShipping(e.target.value)} error={show(errors.shipping)} />
              <Field label={t("payment.discount")} ltr inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} error={show(errors.discount)} />
            </div>
          </Card>
        </div>

        <aside className="lg:sticky lg:top-6">
          <Card title={t("summary.title")}>
            <dl className="flex flex-col gap-2 text-body-sm" data-testid="order-summary">
              <div className="flex justify-between gap-3"><dt className="text-text-2">{t("summary.subtotal")}</dt><dd><MoneyText money={m(subtotal)} /></dd></div>
              <div className="flex justify-between gap-3"><dt className="text-text-2">{t("summary.shipping")}</dt><dd><MoneyText money={m(minor(shipping) ?? 0n)} /></dd></div>
              <div className="flex justify-between gap-3"><dt className="text-text-2">{t("summary.discount")}</dt><dd><MoneyText money={m(minor(discount) ?? 0n)} /></dd></div>
              <div className="flex justify-between gap-3 border-t border-line pt-2 font-medium"><dt>{t("summary.total")}</dt><dd><MoneyText money={m(total)} /></dd></div>
              <div className="flex justify-between gap-3"><dt className="text-text-2">{t("summary.paid")}</dt><dd><MoneyText money={m(paidMinor)} /></dd></div>
              <div className="flex justify-between gap-3 text-body font-semibold"><dt>{t("summary.collect")}</dt><dd><MoneyText money={m(collect)} /></dd></div>
            </dl>
            {mode === "bank_transfer" && !received ? <p className="mt-3 text-caption text-text-3">{t("summary.waitsForTransfer")}</p> : null}
            <p className="mt-3 text-caption text-text-3">{t("summary.next")}</p>
            {tried && !valid ? <div className="mt-3"><Alert tone="danger">{t("errors.fix")}</Alert></div> : null}
            <Button type="submit" className="mt-4 w-full" busy={create.isPending}>{t("submit")}</Button>
          </Card>
        </aside>
      </div>
    </form>
  );
}

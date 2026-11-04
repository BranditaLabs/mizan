"use client";

import { fromMinor, normalizePhone, rolesWith, toAsciiDigits, toMinor, type Money, type PhoneCountry } from "@mizan/shared";
import { Icon } from "@mizan/design-system/icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Bdi } from "@/components/Bdi";
import { ProductImage } from "@/components/catalog/ProductImage";
import { Alert } from "@/components/ui/Alert";
import { Button, IconButton } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Select } from "@/components/ui/Field";
import { ErrorState } from "@/components/ui/QueryState";
import { LeaveGuard } from "@/components/ui/SaveBar";
import { EmptyState } from "@/components/ui/Surface";
import { useToast } from "@/components/ui/Toast";
import { DateText, MoneyText } from "@/components/ui/Values";
import { cx } from "@/components/ui/logic";
import { Link, useRouter } from "@/i18n/navigation";
import { ok, type Schemas } from "@/lib/api/client";
import { useSession } from "@/lib/session";
import { addressBody, addressLine, addressProblems, AddressFields, emptyAddress, type AddressValue } from "./AddressFields";

type NewOrderBody = Schemas["NewOrder"];
type Mode = NewOrderBody["payment"]["mode"];
type Method = NonNullable<NewOrderBody["payment"]["method"]>;
type History = Schemas["CustomerHistory"];
interface Line { key: number; variantId?: string; title: string; sku?: string | null; quantity: number; unitPrice: string; listPrice?: string; currency: string; available?: number | null; picture?: { url: string; alt: string | null } | null }

const SOURCES: readonly NewOrderBody["source"][] = ["phone", "whatsapp", "instagram", "facebook", "tiktok", "walk_in", "other"];
const MODES: readonly Mode[] = ["cod", "partial", "prepaid", "bank_transfer"];
const METHODS: readonly Method[] = ["wallet", "instapay", "card"];
const CREATORS = rolesWith("orders.create");
const AMOUNT = /^\d{1,9}(\.\d{1,2})?$/;
/** Amounts as people type them: Arabic digits and separators, spaces and thousands commas. */
const amount = (v: string) => toAsciiDigits(v).replace(/[٫،]/g, ".").replace(/[\s,]/g, "").trim();

/**
 * New order (M1, E5-5; rebuilt): an order taken on the phone, in WhatsApp or Instagram, or in person,
 * laid out to avoid the mistakes that cost a delivery. The phone first, checked as it is typed, and
 * what Mizan knows of it: earlier orders and refusals, an order still open (a likely duplicate), the
 * last address to use again. The address by governorate (what the courier books by) with the area,
 * a landmark and the map pin. Catalogue prices stay as they are unless changed on purpose; stock is
 * shown. Nothing is created without a last look at everything, and leaving with it half typed asks.
 */
export function NewOrder() {
  const t = useTranslations("newOrder");
  const { api, user, store } = useSession();
  const router = useRouter();
  const toast = useToast();
  const allowed = CREATORS.has(store?.role ?? "");
  const currency = store?.baseCurrency ?? "EGP";
  const country = store?.country ?? "EG";
  const phoneCountry = (["EG", "SA", "AE"].includes(country) ? country : "EG") as PhoneCountry;

  const [source, setSource] = useState<NewOrderBody["source"]>("phone");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState<AddressValue>(emptyAddress);
  const [lines, setLines] = useState<Line[]>([]);
  const [unlocked, setUnlocked] = useState<ReadonlySet<number>>(new Set());
  const [custom, setCustom] = useState({ title: "", price: "" });
  const [shipping, setShipping] = useState("0");
  const [discount, setDiscount] = useState("0");
  const [mode, setMode] = useState<Mode>("cod");
  const [method, setMethod] = useState<Method>("wallet");
  const [paid, setPaid] = useState("");
  const [received, setReceived] = useState(false);
  const [tried, setTried] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [created, setCreated] = useState(false);

  // The phone as Mizan reads it, and what Mizan knows of it once it is a real number (after a pause in typing).
  const e164 = normalizePhone(phone, phoneCountry)?.e164 ?? null;
  const [asked, setAsked] = useState<string | null>(null);
  useEffect(() => { const h = setTimeout(() => setAsked(e164), 400); return () => clearTimeout(h); }, [e164]);
  const history = useQuery({
    queryKey: ["customerHistory", user?.uid ?? "", store?.tenantId ?? "", asked],
    queryFn: () => ok(api.GET("/v1/orders/customer-history", { params: { query: { phone: asked! } } })),
    enabled: Boolean(store) && allowed && Boolean(asked) && asked === e164,
    meta: { toast: false },
    staleTime: 60_000,
  });
  const products = useQuery({
    queryKey: ["orderProducts", user?.uid ?? "", store?.tenantId ?? ""],
    queryFn: () => ok(api.GET("/v1/orders/products")),
    enabled: Boolean(store) && allowed,
  });
  const create = useMutation({
    mutationFn: (body: NewOrderBody) => ok(api.POST("/v1/orders", { body })),
    onSuccess: (r) => { setCreated(true); toast({ message: t("created", { number: r.number }) }); router.push(`/orders/${r.id}`); },
  });

  if (!allowed) return <div className="mx-auto max-w-[860px] px-4 pt-6 md:px-6"><div className="mz-card"><EmptyState icon="locked" title={t("notAllowed.title")} body={t("notAllowed.body")} /></div></div>;

  const cur = lines[0]?.currency ?? currency;
  const minor = (v: string) => (AMOUNT.test(amount(v)) ? toMinor({ amount: amount(v), currency: cur }) : null);
  const subtotal = lines.reduce((a, l) => a + (minor(l.unitPrice) ?? 0n) * BigInt(l.quantity), 0n);
  const total = subtotal + (minor(shipping) ?? 0n) - (minor(discount) ?? 0n);
  const paidMinor = mode === "prepaid" ? total : mode === "partial" ? (minor(paid) ?? 0n) : mode === "bank_transfer" && received ? total : 0n;
  const collect = mode === "bank_transfer" ? 0n : total - paidMinor;
  const m = (x: bigint): Money => fromMinor(x < 0n ? 0n : x, cur);

  const addr = addressProblems(address, country);
  const errors = {
    name: name.trim().length < 2 ? t("errors.name") : null,
    phone: !phone.trim() ? t("errors.phone") : !e164 ? t("errors.phoneInvalid") : null,
    address: Object.keys(addr).length ? t("errors.address") : null,
    lines: lines.length === 0 ? t("errors.lines") : lines.some((l) => minor(l.unitPrice) === null || l.quantity < 1) ? t("errors.linePrice") : null,
    shipping: minor(shipping) === null ? t("errors.amount") : null,
    discount: minor(discount) === null ? t("errors.amount") : (minor(discount) ?? 0n) > subtotal && lines.length ? t("errors.discount") : null,
    paid: mode === "partial" && (minor(paid) === null || paidMinor <= 0n || paidMinor >= total) ? t("errors.deposit") : null,
  };
  const valid = Object.values(errors).every((e) => e === null);
  const show = (e: string | null) => (tried ? e : null);
  const dirty = !created && Boolean(name.trim() || phone.trim() || lines.length || address.line1.trim() || address.city.trim());
  const done = {
    customer: !errors.name && !errors.phone,
    address: !errors.address,
    items: !errors.lines,
    payment: !errors.shipping && !errors.discount && !errors.paid,
  };

  const options = (products.data?.data ?? []).map((p) => ({
    value: p.variantId, label: p.title,
    hint: [p.sku, p.available === null ? null : p.available > 0 ? t("items.inStock", { n: p.available }) : t("items.outOfStock")].filter(Boolean).join(" · ") || undefined,
    media: <ProductImage image={p.picture ? { ...p.picture, width: null, height: null } : null} alt="" size={28} />,
  }));
  const addProduct = (variantId: string) => {
    const p = products.data?.data.find((x) => x.variantId === variantId);
    if (!p) return;
    setLines((ls) => {
      const same = ls.find((l) => l.variantId === variantId);
      if (same) return ls.map((l) => (l === same ? { ...l, quantity: Math.min(999, l.quantity + 1) } : l));
      return [...ls, { key: Date.now(), variantId, title: p.title, sku: p.sku, quantity: 1, unitPrice: p.price.amount, listPrice: p.price.amount, currency: p.price.currency, available: p.available, picture: p.picture }];
    });
  };
  const addCustom = () => {
    if (!custom.title.trim() || minor(custom.price) === null) return;
    setLines((ls) => [...ls, { key: Date.now(), title: custom.title.trim(), quantity: 1, unitPrice: amount(custom.price), currency: cur }]);
    setCustom({ title: "", price: "" });
  };
  const setLine = (key: number, next: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...next } : l)));
  const takeLastAddress = (h: History) => {
    const a = h.lastAddress;
    if (!a) return;
    setAddress({ province: a.province ?? "", city: a.city ?? "", line1: a.line1 ?? "", line2: a.line2 ?? "", locationText: a.location ? `${a.location.lat}, ${a.location.lng}` : "" });
  };

  const body = (): NewOrderBody => ({
    source, customer: { name: name.trim(), phone: e164 ?? phone.trim() },
    address: addressBody(address),
    lines: lines.map((l) => (l.variantId ? { variantId: l.variantId, quantity: l.quantity, unitPrice: amount(l.unitPrice) } : { title: l.title, quantity: l.quantity, unitPrice: amount(l.unitPrice) })),
    shipping: amount(shipping), discount: amount(discount),
    payment: {
      mode, ...(mode !== "cod" ? { method } : {}),
      ...(mode === "partial" ? { paid: amount(paid) } : mode === "bank_transfer" && received ? { paid: fromMinor(total, cur).amount } : {}),
    },
  });
  // Enter or the button: a last look first, never straight to an order.
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (valid) setReviewing(true);
    else document.querySelector<HTMLElement>("[aria-invalid=true]")?.focus();
  };

  const h = history.data;
  const known = h?.known && h.orders.total > 0;
  const refused = h ? h.orders.returned + h.orders.cancelled : 0;

  return (
    <form onSubmit={submit} noValidate className="mx-auto flex max-w-[1100px] flex-col gap-5 px-4 pt-6 pb-14 md:px-6" data-testid="new-order">
      <LeaveGuard when={dirty} />
      <header>
        <h1 className="font-display text-heading-lg">{t("title")}</h1>
        <p className="mt-1 text-body-sm text-text-2">{t("subtitle")}</p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="flex min-w-0 flex-col gap-5">
          <Step n={1} title={t("customer.title")} done={done.customer}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Field label={t("customer.phone")} ltr type="tel" inputMode="tel" autoComplete="off" placeholder={t("customer.phonePlaceholder")} value={phone}
                  onChange={(e) => setPhone(e.target.value)} error={show(errors.phone) ?? (phone.trim().length >= 6 && !e164 ? t("errors.phoneInvalid") : undefined)} />
                {e164 ? <p className="text-caption text-text-2" data-testid="phone-read"><Icon name="confirm" size={14} className="me-1 inline text-success-text" />{t("customer.phoneRead")} <Bdi code>{e164}</Bdi></p> : null}
              </div>
              <Field label={t("customer.name")} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} error={show(errors.name)} />
              <Select label={t("customer.source")} value={source} onChange={(e) => setSource(e.target.value as NewOrderBody["source"])}>
                {SOURCES.map((s) => <option key={s} value={s}>{t(`source.${s}`)}</option>)}
              </Select>
            </div>
            {/* What Mizan knows of this phone: before anything is typed twice or shipped to someone who refuses. */}
            {h ? (
              <div className={cx("mt-4 flex flex-col gap-2 rounded-md border p-3 text-body-sm", h.openOrders.length || refused ? "border-warning bg-warning-soft" : "border-line bg-surface-sunk")} data-testid="customer-history">
                {known ? (
                  <>
                    <p className="font-medium">{t("history.returning", { name: h.name ?? "" })}</p>
                    <p className="text-text-2">{t("history.counts", { total: h.orders.total, delivered: h.orders.delivered, returned: h.orders.returned, cancelled: h.orders.cancelled })}</p>
                    {refused ? <p className="text-warning-text">{t("history.refused", { n: refused })}</p> : null}
                    {h.openOrders.map((o) => (
                      <p key={o.id} className="text-warning-text">
                        {t.rich("history.open", { number: o.number, b: (c) => <Link href={`/orders/${o.id}`} className="font-medium underline"><Bdi>{c}</Bdi></Link> })}{" "}
                        <DateText value={o.placedAt} relative />
                      </p>
                    ))}
                    <div className="flex flex-wrap gap-2">
                      {h.name && !name.trim() ? <Button size="sm" variant="secondary" onClick={() => setName(h.name!)}>{t("history.useName")}</Button> : null}
                      {h.lastAddress ? <Button size="sm" variant="secondary" icon="pin" onClick={() => takeLastAddress(h)}>{t("history.useAddress")}</Button> : null}
                    </div>
                  </>
                ) : <p className="text-text-2">{t("history.new")}</p>}
              </div>
            ) : null}
          </Step>

          <Step n={2} title={t("address.title")} done={done.address}>
            <AddressFields value={address} onChange={setAddress} country={country} showErrors={tried} />
          </Step>

          <Step n={3} title={t("items.title")} done={done.items}>
            <div className="flex flex-col gap-4">
              {/* The catalogue could not be loaded: say so, not "no products" (a one-off item still works). */}
              {products.isError && !products.data ? <ErrorState compact className="rounded-md border border-line" error={products.error} onRetry={() => void products.refetch()} retrying={products.isRefetching} />
                : <Combobox label={t("items.pick")} options={options} value={null} onChange={addProduct} emptyText={t("items.noProducts")} placeholder={t("items.pickPlaceholder")} />}
              {lines.length ? (
                <ul className="flex flex-col divide-y divide-line" data-testid="order-lines">
                  {lines.map((l) => {
                    const short = l.available !== undefined && l.available !== null && l.quantity > l.available;
                    const priceOpen = !l.variantId || unlocked.has(l.key);
                    const changed = l.listPrice !== undefined && amount(l.unitPrice) !== l.listPrice;
                    return (
                      <li key={l.key} className="flex flex-col gap-2 py-3">
                        <div className="flex flex-wrap items-center gap-3">
                          <div className="flex min-w-40 flex-1 items-center gap-3">
                            {l.variantId ? <ProductImage image={l.picture ? { ...l.picture, width: null, height: null } : null} alt="" size={40} /> : null}
                            <div className="min-w-0">
                              <p className="text-body-sm font-medium">{l.title}</p>
                              <p className="text-caption text-text-3">
                                {l.sku ? <Bdi code>{l.sku}</Bdi> : null}
                                {l.available !== undefined && l.available !== null ? <span className={cx("ms-2", short && "text-danger-text")}>{l.available > 0 ? t("items.inStock", { n: l.available }) : t("items.outOfStock")}</span> : null}
                              </p>
                            </div>
                          </div>
                          {/* Quantity with − and +: no 10 for a 1 by a slip of the keyboard. */}
                          <div className="flex items-center gap-1" role="group" aria-label={t("items.quantity")}>
                            <Button size="sm" variant="secondary" aria-label={t("items.less")} disabled={l.quantity <= 1} onClick={() => setLine(l.key, { quantity: l.quantity - 1 })}>−</Button>
                            <input aria-label={t("items.quantity")} dir="ltr" inputMode="numeric" className="mz-input w-14 text-center" value={String(l.quantity)}
                              onChange={(e) => setLine(l.key, { quantity: Math.max(1, Math.min(999, Math.round(Number(toAsciiDigits(e.target.value)) || 1))) })} />
                            <Button size="sm" variant="secondary" aria-label={t("items.more")} disabled={l.quantity >= 999} onClick={() => setLine(l.key, { quantity: l.quantity + 1 })}>+</Button>
                          </div>
                          {priceOpen ? (
                            <Field label={t("items.price")} ltr inputMode="decimal" className="w-32" value={l.unitPrice} onChange={(e) => setLine(l.key, { unitPrice: e.target.value })}
                              error={minor(l.unitPrice) === null ? t("errors.amount") : undefined} />
                          ) : (
                            <div className="flex flex-col items-end text-body-sm">
                              <MoneyText money={{ amount: l.unitPrice, currency: l.currency }} />
                              <button type="button" className="text-caption text-text-2 underline" onClick={() => setUnlocked((s) => new Set([...s, l.key]))}>{t("items.changePrice")}</button>
                            </div>
                          )}
                          <span className="w-28 text-end text-body-sm font-medium"><MoneyText money={m((minor(l.unitPrice) ?? 0n) * BigInt(l.quantity))} /></span>
                          <IconButton icon="delete" label={t("items.remove", { title: l.title })} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} />
                        </div>
                        {short ? <p className="text-caption text-danger-text">{t("items.short", { n: l.available ?? 0 })}</p> : null}
                        {changed ? <p className="text-caption text-warning-text">{t.rich("items.priceChanged", { was: () => <MoneyText money={{ amount: l.listPrice!, currency: l.currency }} /> })}</p> : null}
                      </li>
                    );
                  })}
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
          </Step>

          <Step n={4} title={t("payment.title")} done={done.payment}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Select label={t("payment.mode")} value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
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
          </Step>
        </div>

        <aside className="lg:sticky lg:top-20">
          <div className="mz-card flex flex-col gap-3 p-5" data-testid="order-summary-card">
            <h2 className="text-heading-sm">{t("summary.title")}</h2>
            <Totals t={t} m={m} subtotal={subtotal} shipping={minor(shipping) ?? 0n} discount={minor(discount) ?? 0n} total={total} paid={paidMinor} collect={collect} />
            {mode === "bank_transfer" && !received ? <p className="text-caption text-text-3">{t("summary.waitsForTransfer")}</p> : null}
            {tried && !valid ? <Alert tone="danger">{t("errors.fix")}</Alert> : null}
            <Button type="submit" className="w-full" icon="confirm">{t("review.open")}</Button>
            <p className="text-caption text-text-3">{t("summary.next")}</p>
          </div>
        </aside>
      </div>

      {reviewing ? (
        <Dialog open onClose={() => setReviewing(false)} title={t("review.title")} description={t("review.body")} className="max-w-xl"
          footer={(
            <>
              <Button variant="secondary" onClick={() => setReviewing(false)}>{t("review.back")}</Button>
              <Button busy={create.isPending} onClick={() => create.mutate(body())} data-autofocus>{t("submit")}</Button>
            </>
          )}>
          <div className="flex flex-col gap-4 text-body-sm" data-testid="order-review">
            <section>
              <h3 className="text-caption text-text-3">{t("review.customer")}</h3>
              <p className="font-medium"><Bdi>{name.trim()}</Bdi> · <Bdi code>{e164}</Bdi></p>
              <p className="text-text-2">{t(`source.${source}`)}</p>
            </section>
            <section>
              <h3 className="text-caption text-text-3">{t("review.address")}</h3>
              <p><Bdi>{addressLine(address, "، ")}</Bdi></p>
              <p className="text-text-2">{addressBody(address).location ? t("review.pin") : t("review.noPin")}</p>
            </section>
            <section>
              <h3 className="text-caption text-text-3">{t("review.items")}</h3>
              <ul className="flex flex-col gap-1">
                {lines.map((l) => (
                  <li key={l.key} className="flex justify-between gap-3">
                    <span>{t("review.line", { n: l.quantity, title: l.title })}</span>
                    <MoneyText money={m((minor(l.unitPrice) ?? 0n) * BigInt(l.quantity))} />
                  </li>
                ))}
              </ul>
            </section>
            <Totals t={t} m={m} subtotal={subtotal} shipping={minor(shipping) ?? 0n} discount={minor(discount) ?? 0n} total={total} paid={paidMinor} collect={collect} />
            {h?.openOrders.length ? <Alert tone="warning">{t("review.duplicate", { number: h.openOrders[0]!.number })}</Alert> : null}
            {create.isError ? <Alert tone="danger">{t("review.failed")}</Alert> : null}
          </div>
        </Dialog>
      ) : null}
    </form>
  );
}

/** A numbered part of the form, ticked once it is complete. */
function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: ReactNode }) {
  return (
    <section className="mz-card flex flex-col gap-4 p-5" aria-label={title}>
      <h2 className="flex items-center gap-2.5 text-heading-sm">
        <span className={cx("inline-flex size-7 items-center justify-center rounded-full border text-caption", done ? "border-transparent bg-success-soft text-success-text" : "border-line text-text-2")} aria-hidden="true">
          {done ? <Icon name="confirm" size={14} /> : <bdi className="mz-num">{n}</bdi>}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Totals({ t, m, subtotal, shipping, discount, total, paid, collect }: {
  t: ReturnType<typeof useTranslations<"newOrder">>; m: (x: bigint) => Money; subtotal: bigint; shipping: bigint; discount: bigint; total: bigint; paid: bigint; collect: bigint;
}) {
  const row = (label: string, v: bigint, strong = false) => (
    <div className={cx("flex justify-between gap-3", strong && "font-medium")}><dt className={strong ? undefined : "text-text-2"}>{label}</dt><dd><MoneyText money={m(v)} /></dd></div>
  );
  return (
    <dl className="flex flex-col gap-2 text-body-sm" data-testid="order-summary">
      {row(t("summary.subtotal"), subtotal)}
      {row(t("summary.shipping"), shipping)}
      {discount > 0n ? row(t("summary.discount"), discount) : null}
      <div className="border-t border-line pt-2">{row(t("summary.total"), total, true)}</div>
      {paid > 0n ? row(t("summary.paid"), paid) : null}
      <div className="flex justify-between gap-3 text-body font-semibold"><dt>{t("summary.collect")}</dt><dd><MoneyText money={m(collect)} /></dd></div>
    </dl>
  );
}

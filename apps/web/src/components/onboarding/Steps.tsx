"use client";

import { Waiting } from "@/components/ui/Loader";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Icon, type IconProps } from "@mizan/design-system/icons/react";
import { Bdi } from "@/components/Bdi";
import { Alert } from "@/components/ui/Alert";
import { Button, ButtonGroup, buttonClass } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { ErrorState } from "@/components/ui/QueryState";
import { EmptyState } from "@/components/ui/Surface";
import { MoneyText } from "@/components/ui/Values";
import { Link } from "@/i18n/navigation";
import { ok } from "@/lib/api/client";
import { formatDuration } from "@/lib/format";
import { useSession } from "@/lib/session";
import { WooCommerceConnect } from "@/components/settings/WooCommerceConnect";
import { shopDomain } from "./shop-domain";
import { useRefreshOnboarding, useUpdateOnboarding, type Onboarding } from "./useOnboarding";
import { ProviderLogo } from "@/components/ui/PartnerLogo";

const n = (c: React.ReactNode) => <Bdi code>{c}</Bdi>;


type Channel = NonNullable<Onboarding["steps"]["store"]["channel"]>;
const CHANNELS: ReadonlyArray<{ id: Channel; icon: IconProps["name"] }> = [
  { id: "shopify", icon: "channels" }, { id: "woocommerce", icon: "channels" }, { id: "easyorders", icon: "cart" },
  { id: "other", icon: "more" }, { id: "manual", icon: "edit" },
];
/** Platforms Mizan connects today; the others are recorded (they decide what we build next) and start by hand. */
const CONNECTS: ReadonlySet<Channel> = new Set(["shopify", "woocommerce"]);

/** The sales channels as a choice of cards (A1): where the store sells, first thing in setup. */
function ChannelPicker({ value, only, onPick, busy }: { value: Channel | null; only?: ReadonlySet<Channel> | undefined; onPick(c: Channel): void; busy: boolean }) {
  const t = useTranslations("onboarding.store");
  return (
    <div role="radiogroup" aria-label={t("pickLabel")} className="grid gap-2 sm:grid-cols-2">
      {CHANNELS.filter((c) => !only || only.has(c.id)).map((c) => (
        <button key={c.id} type="button" role="radio" aria-checked={value === c.id} disabled={busy} onClick={() => onPick(c.id)}
          className={`flex items-start gap-3 rounded-md border p-3 text-start transition-colors ${value === c.id ? "border-line-strong bg-surface-selected" : "border-line hover:bg-surface-hover"}`}>
          {c.id === "other" || c.id === "manual"
            ? <span className="mt-0.5 text-text-2"><Icon name={c.icon} size={18} /></span>
            : <ProviderLogo slug={c.id} size={32} />}
          <span className="min-w-0">
            <span className="block text-label">{t(`channels.${c.id}.title`)}</span>
            <span className="block text-caption text-text-3">{t(`channels.${c.id}.body`)}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * The store step (A1): choose the sales channel, then connect it. Shopify and WooCommerce connect
 * here (the import then runs in the background); EasyOrders and other platforms are recorded and
 * start by hand; "manual" sells with orders typed in until an online store is connected.
 */
export function StoreStep({ o }: { o: Onboarding }) {
  const t = useTranslations("onboarding.store");
  const { api } = useSession();
  const update = useUpdateOnboarding();
  const refresh = useRefreshOnboarding();
  const [shop, setShop] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [picked, setPicked] = useState<Channel | null>(null);
  const [woo, setWoo] = useState(false);
  const install = useMutation({
    mutationFn: (domain: string) => ok(api.GET("/v1/connections/shopify/install", { params: { query: { shop: domain } } })),
    // Shopify's consent screen; it sends the browser back to /integrations/shopify/connect.
    onSuccess: ({ authorizeUrl }) => window.location.assign(authorizeUrl),
  });
  // A2: import the history again after a failure; the new run's progress replaces the failed one.
  const retry = useMutation({
    mutationFn: (id: string) => ok(api.POST("/v1/connections/{id}/import", { params: { path: { id } } })),
    onSuccess: () => { void refresh(); },
  });
  const s = o.steps.store;
  const pick = (c: Channel) => {
    setPicked(c === "manual" ? null : c);
    if (c !== s.channel) update.mutate({ channel: c });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const domain = shopDomain(shop);
    setInvalid(!domain);
    if (domain) install.mutate(domain);
  };

  /** What the chosen channel needs next. */
  const panel = (c: Channel | null) => {
    if (c === "shopify") {
      return (
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <ProviderLogo slug="shopify" size={28} shape="lockup" />
          <Field label={t("field")} hint={t.rich("hint", { n })} error={invalid ? t("invalid") : null} ltr autoComplete="off" spellCheck={false}
            placeholder="nile-abayas.myshopify.com" value={shop} onChange={(e) => setShop(e.target.value)} name="shop" />
          <div><Button type="submit" icon="channels" busy={install.isPending || install.isSuccess}>{t("submit")}</Button></div>
        </form>
      );
    }
    if (c === "woocommerce") {
      return (
        <div className="flex flex-col items-start gap-3">
          <ProviderLogo slug="woocommerce" size={28} shape="lockup" />
          <p className="text-body-sm text-text-2">{t("wooBody")}</p>
          <Button icon="channels" onClick={() => setWoo(true)}>{t("wooCta")}</Button>
          <WooCommerceConnect open={woo} onClose={() => { setWoo(false); void refresh(); }} />
        </div>
      );
    }
    if (c === "easyorders" || c === "other") {
      return (
        <Alert tone="info" title={t("laterTitle")}>
          <span className="flex flex-col items-start gap-2">
            {t("laterBody")}
            <Button variant="secondary" size="sm" busy={update.isPending} onClick={() => pick("manual")}>{t("useManual")}</Button>
          </span>
        </Alert>
      );
    }
    return null;
  };

  if (s.status === "done" && !picked) {
    if (!s.connectionId) {
      // Selling by hand: the setup goes on; an online store can be connected any time.
      return (
        <div className="flex flex-col gap-3">
          <Alert tone="success" title={t("manualTitle")}>{t("manualBody")}</Alert>
          <ButtonGroup>
            <Link href="/orders/new" className={buttonClass("secondary")}>{t("newOrder")}</Link>
            <Button variant="ghost" icon="channels" onClick={() => setPicked("shopify")}>{t("connectOnline")}</Button>
          </ButtonGroup>
        </div>
      );
    }
    const imp = s.import;
    return (
      <div className="flex flex-col gap-3">
        <Alert tone="success">{t.rich("connected", { shop: s.shop ?? "", n })}</Alert>
        {s.missingScopes.length > 0 && s.shop ? (
          <Alert tone="warning">
            <span className="flex flex-col items-start gap-2">
              {t("scopesChanged")}
              <Button variant="secondary" size="sm" icon="refresh" busy={install.isPending || install.isSuccess} onClick={() => install.mutate(s.shop!)}>{t("approveScopes")}</Button>
            </span>
          </Alert>
        ) : null}
        {imp?.status === "failed" ? (
          <Alert tone="danger" title={t("importFailed")}>
            <span className="flex flex-col items-start gap-2">
              {t(imp.error === "auth" || imp.error === "permission" ? `importWhy.${imp.error}` : "importWhy.other", { orders: imp.orders })}
              <Button variant="secondary" size="sm" icon="refresh" busy={retry.isPending} onClick={() => retry.mutate(s.connectionId!)}>{t("retryImport")}</Button>
            </span>
          </Alert>
        ) : imp ? (
          <p className="text-body-sm text-text-2" role="status">
            {t(imp.status === "running" ? "importing" : "imported", { orders: imp.orders, products: imp.products })}
          </p>
        ) : null}
        {retry.isError ? <Alert tone="danger">{t("retryFailed")}</Alert> : null}
        {/* U7: the other stores too, each with its state: before, only the first could be retried or re-approved. */}
        {s.stores.filter((x) => x.connectionId !== s.connectionId).length ? (
          <ul className="flex flex-col divide-y divide-line rounded-md border border-line" data-testid="other-stores">
            {s.stores.filter((x) => x.connectionId !== s.connectionId).map((x) => (
              <li key={x.connectionId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-body-sm">
                <span className="flex min-w-0 items-center gap-2"><ProviderLogo slug={x.provider} /><Bdi>{x.displayName ?? x.shop ?? x.provider}</Bdi></span>
                <span className="flex items-center gap-2">
                  <span className={x.status === "active" ? "text-text-2" : "text-danger-text"}>{t(`otherStatus.${x.status}`)}</span>
                  {x.status === "needs_attention" && x.provider === "shopify" && x.shop
                    ? <Button size="sm" variant="secondary" busy={install.isPending} onClick={() => install.mutate(x.shop!)}>{t("approveScopes")}</Button> : null}
                  {x.status !== "pending" ? <Button size="sm" variant="ghost" icon="refresh" busy={retry.isPending && retry.variables === x.connectionId} onClick={() => retry.mutate(x.connectionId)}>{t("retryImport")}</Button> : null}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {/* Several stores per account (E2-7): each one syncs on its own. */}
        <div><Button variant="ghost" size="sm" icon="add" onClick={() => setPicked("shopify")}>{t("another")}</Button></div>
      </div>
    );
  }

  // Choosing: every channel before a store is connected; only the connectable ones when adding another.
  const adding = s.status === "done";
  const value = picked ?? (adding ? null : s.channel);
  return (
    <div className="flex flex-col gap-4">
      <ChannelPicker value={value} only={adding ? CONNECTS : undefined} onPick={adding ? setPicked : pick} busy={update.isPending} />
      {update.isError ? <Alert tone="danger">{t("saveFailed")}</Alert> : null}
      {panel(value)}
    </div>
  );
}

export function CourierStep({ o }: { o: Onboarding }) {
  const t = useTranslations("onboarding.courier");
  const { api } = useSession();
  const refresh = useRefreshOnboarding();
  const update = useUpdateOnboarding();
  const [key, setKey] = useState("");
  const [replacing, setReplacing] = useState(false);
  const save = useMutation({
    mutationFn: (apiKey: string) => ok(api.POST("/v1/connections/bosta", { body: { apiKey } })),
    onSuccess: () => { setKey(""); setReplacing(false); void refresh(); },
  });
  const c = o.steps.courier;

  if (o.steps.store.status !== "done") return <p className="text-body-sm text-text-2">{t("needsStore")}</p>;
  // Bosta's jobs run with the store's sync, so selling by hand ships with couriers recorded per order (E7-6).
  if (!o.steps.store.connectionId && c.status !== "done" && c.status !== "checking") {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-body-sm text-text-2">{t("manualStore")}</p>
        {c.status === "todo" ? <div><Button variant="secondary" busy={update.isPending} onClick={() => update.mutate({ skip: { courier: true } })}>{t("skipManual")}</Button></div> : null}
      </div>
    );
  }
  if (c.status === "checking") {
    return (
      <Waiting meaning="syncing" live>{t("checking")}</Waiting>
    );
  }
  if (c.status === "done" && !replacing) {
    return (
      <div className="flex flex-col gap-3">
        <Alert tone="success">{t("done")}</Alert>
        <div><Button variant="ghost" size="sm" onClick={() => setReplacing(true)}>{t("replace")}</Button></div>
      </div>
    );
  }
  if (c.status === "skipped") {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-body-sm text-text-2">{t("skipped")}</p>
        <div><Button variant="secondary" busy={update.isPending} onClick={() => update.mutate({ skip: { courier: false } })}>{t("undoSkip")}</Button></div>
      </div>
    );
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (key.trim()) save.mutate(key.trim()); }} className="flex flex-col gap-4" noValidate>
      <ProviderLogo slug="bosta" size={28} shape="lockup" />
      {c.status === "needs_attention" ? <Alert tone="danger">{t(c.reason === "key_lacks_permission" ? "noPermission" : "refused")}</Alert> : null}
      <Field label={t("field")} hint={t("hint")} type="password" ltr autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} name="bostaKey" />
      <ButtonGroup>
        <Button type="submit" icon="courier" busy={save.isPending} disabled={!key.trim()}>{t("submit")}</Button>
        {c.status === "todo" ? <Button variant="ghost" busy={update.isPending} onClick={() => update.mutate({ skip: { courier: true } })}>{t("skip")}</Button> : null}
      </ButtonGroup>
    </form>
  );
}

const DECIMAL = /^\d{1,12}(\.\d{1,3})?$/;
const toAscii = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[٫,]/g, ".").trim();

export function CostsStep({ o }: { o: Onboarding }) {
  const t = useTranslations("onboarding.costs");
  const { api, user, store } = useSession();
  const qc = useQueryClient();
  const refresh = useRefreshOnboarding();
  const update = useUpdateOnboarding();
  const [limit, setLimit] = useState(20);
  const [costs, setCosts] = useState<Record<string, string>>({});
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const key = ["costs", user?.uid ?? "", store?.tenantId ?? "", limit] as const;
  const list = useQuery({
    queryKey: key,
    queryFn: () => ok(api.GET("/v1/products/variants/costs", { params: { query: { missingCost: "true", limit } } })),
    enabled: o.steps.store.status === "done" && o.steps.costs.status !== "skipped" && o.steps.costs.variants > 0,
  });
  const save = useMutation({
    mutationFn: (items: Array<{ variantId: string; cost: string }>) => ok(api.PUT("/v1/products/variants/costs", { body: { items } })),
    onSuccess: () => { setCosts({}); void qc.invalidateQueries({ queryKey: ["costs"] }); void refresh(); },
  });
  const c = o.steps.costs;

  if (o.steps.store.status !== "done") return <p className="text-body-sm text-text-2">{t("none")}</p>;
  if (c.status === "skipped") {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-body-sm text-text-2">{t("skipped")}</p>
        <div><Button variant="secondary" busy={update.isPending} onClick={() => update.mutate({ skip: { costs: false } })}>{t("undoSkip")}</Button></div>
      </div>
    );
  }
  if (c.status === "done") return <Alert tone="success">{t("allSet")}</Alert>;
  if (c.variants === 0) {
    // No products yet (an import still running, or selling by hand): add them, or come back later.
    return (
      <div className="flex flex-col gap-3">
        <p className="text-body-sm text-text-2">{t(o.steps.store.connectionId ? "none" : "noneManual")}</p>
        <ButtonGroup>
          <Link href="/products" className={buttonClass("secondary")}>{t("addProducts")}</Link>
          <Button variant="ghost" busy={update.isPending} onClick={() => update.mutate({ skip: { costs: true } })}>{t("skip")}</Button>
        </ButtonGroup>
      </div>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const entries = Object.entries(costs).map(([variantId, v]) => ({ variantId, cost: toAscii(v) })).filter((x) => x.cost !== "");
    const bad = new Set(entries.filter((x) => !DECIMAL.test(x.cost)).map((x) => x.variantId));
    setInvalid(bad);
    if (bad.size === 0 && entries.length) save.mutate(entries);
  };
  const rows = list.data?.data ?? [];
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <p className="text-body-sm text-text-2">{t("count", { missing: c.missingCost, total: c.variants })}</p>
      {list.isError && !list.data ? <ErrorState compact className="rounded-md border border-line" error={list.error} onRetry={() => void list.refetch()} retrying={list.isRefetching} /> : null}
      <ul className="flex flex-col divide-y divide-line rounded-md border border-line empty:hidden">
        {rows.map((v) => (
          <li key={v.variantId} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-label">{v.productTitle}{v.variantTitle ? <span className="text-text-3">{" · "}{v.variantTitle}</span> : null}</p>
              <p className="text-caption text-text-3"><Bdi code>{v.sku}</Bdi>{" · "}{t("price")}{" "}<MoneyText money={v.price} /></p>
            </div>
            <label className="flex items-center gap-2">
              <span className="sr-only">{t("cost")}{" "}{v.productTitle}</span>
              <input dir="ltr" inputMode="decimal" autoComplete="off" placeholder="0.00" aria-invalid={invalid.has(v.variantId) || undefined}
                className="mz-input mz-num h-8 w-28 text-start" value={costs[v.variantId] ?? ""} name={`cost-${v.variantId}`}
                onChange={(e) => setCosts({ ...costs, [v.variantId]: e.target.value })} />
              <span className="text-caption text-text-3" dir="ltr">{v.price.currency}</span>
            </label>
          </li>
        ))}
      </ul>
      {invalid.size ? <Alert tone="danger">{t("invalid")}</Alert> : null}
      {save.isSuccess ? <Alert tone="success">{t("saved", { count: save.data.updated })}</Alert> : null}
      <ButtonGroup>
        <Button type="submit" busy={save.isPending} disabled={!Object.values(costs).some((v) => v.trim())}>{t("save")}</Button>
        {list.data?.nextCursor ? <Button variant="secondary" onClick={() => setLimit((l) => Math.min(200, l + 40))}>{t("more")}</Button> : null}
        <Button variant="ghost" busy={update.isPending} onClick={() => update.mutate({ skip: { costs: true } })}>{t("skip")}</Button>
      </ButtonGroup>
    </form>
  );
}

export function FirstOrderStep({ o }: { o: Onboarding }) {
  const t = useTranslations("onboarding.firstOrder");
  const tr = useTranslations("onboarding.ready");
  const locale = useLocale();
  const f = o.steps.firstOrder;
  if (f.status === "waiting") {
    return (
      <EmptyState icon="orders" title={t("waiting")} body={t(o.steps.store.connectionId ? "waitingBody" : "waitingManual")}
        action={<Link href="/orders/new" className={buttonClass(o.steps.store.connectionId ? "secondary" : "primary")}>{t("createOrder")}</Link>} />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <Alert tone="success" title={t("done")}>
        {t.rich("order", { number: f.number ?? "", total: "", n, m: () => (f.total ? <MoneyText money={f.total} /> : null) })}
      </Alert>
      {o.timeToFirstValueS !== null ? <p className="text-body-sm text-text-2" data-testid="ttfv">{t("ttfv", { duration: formatDuration(o.timeToFirstValueS, locale) })}</p> : null}
      <div><Link href="/" className="mz-btn mz-btn--secondary">{tr("cta")}</Link></div>
    </div>
  );
}

const GROW_HREF = { team: "/settings/team", whatsapp: "/settings/confirmation", payments: "/settings/payments", returns: "/settings/refunds" } as const;
type GrowKey = keyof typeof GROW_HREF;

/**
 * Growing the store (A4): the team, WhatsApp confirmation, payment links and deposits, returns. Each
 * says what it changes, opens the screen where it's done, and can be skipped; its status comes from
 * the store itself (someone invited, WhatsApp connected, the settings saved).
 */
export function GrowStep({ o, step }: { o: Onboarding; step: string }) {
  const t = useTranslations("onboarding.grow");
  const update = useUpdateOnboarding();
  if (!(step in GROW_HREF)) return null;
  const key = step as GrowKey;
  const st = o.steps[key].status;
  return (
    <div className="flex flex-col gap-4">
      <p className="flex max-w-[60ch] items-start gap-3 text-body-sm text-text-2">{key === "whatsapp" ? <ProviderLogo slug="whatsapp" size={32} /> : null}<span>{t(`${key}.body`)}</span></p>
      {key === "team" && (o.steps.team.members > 1 || o.steps.team.invited > 0)
        ? <p className="text-body-sm text-text-2">{t("team.count", { members: o.steps.team.members, invited: o.steps.team.invited })}</p> : null}
      {st === "done" ? <Alert tone="success">{t(`${key}.done`)}</Alert> : null}
      {st === "skipped" ? <p className="text-body-sm text-text-2">{t("skipped")}</p> : null}
      {st === "checking" ? <Waiting meaning="syncing" live>{t("whatsapp.checking")}</Waiting> : null}
      {st === "needs_attention" ? <Alert tone="danger">{t("whatsapp.attention")}</Alert> : null}
      <ButtonGroup>
        <Link href={GROW_HREF[key]} className={buttonClass(st === "done" ? "secondary" : "primary")}>{t(`${key}.cta`)}</Link>
        {st === "todo" ? <Button variant="ghost" busy={update.isPending} onClick={() => update.mutate({ skip: { [key]: true } })}>{t("skip")}</Button> : null}
        {st === "skipped" ? <Button variant="ghost" busy={update.isPending} onClick={() => update.mutate({ skip: { [key]: false } })}>{t("undoSkip")}</Button> : null}
      </ButtonGroup>
    </div>
  );
}

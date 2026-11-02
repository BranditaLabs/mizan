"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Icon, type IconProps } from "@mizan/design-system/icons/react";
import { Bdi } from "@/components/Bdi";
import { Alert } from "@/components/ui/Alert";
import { Button, ButtonGroup, buttonClass } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/Surface";
import { MoneyText } from "@/components/ui/Values";
import { Link } from "@/i18n/navigation";
import { ok } from "@/lib/api/client";
import { formatDuration } from "@/lib/format";
import { useSession } from "@/lib/session";
import { WooCommerceConnect } from "@/components/settings/WooCommerceConnect";
import { shopDomain } from "./shop-domain";
import { useRefreshOnboarding, useUpdateOnboarding, type Onboarding } from "./useOnboarding";

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
          <span className="mt-0.5 text-text-2"><Icon name={c.icon} size={18} /></span>
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
          <Field label={t("field")} hint={t.rich("hint", { n })} error={invalid ? t("invalid") : null} ltr autoComplete="off" spellCheck={false}
            placeholder="nile-abayas.myshopify.com" value={shop} onChange={(e) => setShop(e.target.value)} name="shop" />
          <div><Button type="submit" icon="channels" busy={install.isPending || install.isSuccess}>{t("submit")}</Button></div>
        </form>
      );
    }
    if (c === "woocommerce") {
      return (
        <div className="flex flex-col items-start gap-3">
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
        {imp ? (
          <p className="text-body-sm text-text-2" role="status">
            {t(imp.status === "running" ? "importing" : "imported", { orders: imp.orders, products: imp.products })}
          </p>
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
      <p role="status" className="flex items-center gap-2.5 text-body-sm text-text-2">
        <span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-line-strong border-t-transparent" />
        {t("checking")}
      </p>
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
      <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
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

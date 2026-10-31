"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Bdi } from "@/components/Bdi";
import { Alert } from "@/components/ui/Alert";
import { Button, ButtonGroup } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/Surface";
import { MoneyText } from "@/components/ui/Values";
import { Link } from "@/i18n/navigation";
import { ok } from "@/lib/api/client";
import { formatDuration } from "@/lib/format";
import { useSession } from "@/lib/session";
import { shopDomain } from "./shop-domain";
import { useRefreshOnboarding, useUpdateOnboarding, type Onboarding } from "./useOnboarding";

const n = (c: React.ReactNode) => <Bdi code>{c}</Bdi>;


export function StoreStep({ o }: { o: Onboarding }) {
  const t = useTranslations("onboarding.store");
  const { api } = useSession();
  const [shop, setShop] = useState("");
  const [invalid, setInvalid] = useState(false);
  const install = useMutation({
    mutationFn: (domain: string) => ok(api.GET("/v1/connections/shopify/install", { params: { query: { shop: domain } } })),
    // Shopify's consent screen; it sends the browser back to /integrations/shopify/connect.
    onSuccess: ({ authorizeUrl }) => window.location.assign(authorizeUrl),
  });
  const [another, setAnother] = useState(false);
  const s = o.steps.store;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const domain = shopDomain(shop);
    setInvalid(!domain);
    if (domain) install.mutate(domain);
  };
  const form = (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Field label={t("field")} hint={t.rich("hint", { n })} error={invalid ? t("invalid") : null} ltr autoComplete="off" spellCheck={false}
        placeholder="nile-abayas.myshopify.com" value={shop} onChange={(e) => setShop(e.target.value)} name="shop" />
      <div><Button type="submit" icon="channels" busy={install.isPending || install.isSuccess}>{t("submit")}</Button></div>
    </form>
  );

  if (s.status === "done") {
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
        {another ? form : <div><Button variant="ghost" size="sm" icon="add" onClick={() => setAnother(true)}>{t("another")}</Button></div>}
      </div>
    );
  }

  return form;
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
    enabled: o.steps.store.status === "done" && o.steps.costs.status !== "skipped",
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
  if (c.variants === 0) return <p className="text-body-sm text-text-2">{t("none")}</p>;

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
  if (f.status === "waiting") return <EmptyState icon="orders" title={t("waiting")} body={t("waitingBody")} />;
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

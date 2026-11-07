"use client";

import { COUNTRY_CODES, LEGAL_VERSIONS } from "@mizan/shared";
import { useMutation } from "@tanstack/react-query";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";
import { Bdi } from "@/components/Bdi";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Choice";
import { LegalLink } from "@/components/legal/LegalLink";
import { Field } from "@/components/ui/Field";
import { useRouter } from "@/i18n/navigation";
import { TrialChip } from "./fields";
import { AuthHeading, Step } from "./kit";
import { ApiError, idempotency, ok, type MyInvitation, type Schemas } from "@/lib/api/client";
import { isLegalVersionChanged } from "@/lib/legal";
import { signupIntent, trialChoice } from "@/lib/auth/intent";
import { resume } from "@/lib/next-path";
import { useSession } from "@/lib/session";

/**
 * After sign-in without a store: join a store you were invited to (the API matches the invitation
 * to your verified email or phone), or create one (you become its owner, and accept the terms of
 * service and the DPA for it: their versions are recorded with the store, L1-3).
 */
export function Welcome() {
  const t = useTranslations("welcome");
  const tr = useTranslations("roles");
  const tl = useTranslations("legal");
  const tc = useTranslations("countries");
  const ts = useTranslations("shell");
  const format = useFormatter();
  const locale = useLocale();
  const router = useRouter();
  const { user, me, api, refreshMe, selectStore, signOut } = useSession();
  const countryId = useId();

  // Sent here by a Shopify install: the store's name starts from the shop and Shopify's own name and logo
  // replace it on connect. Read once (this tab's storage; the page renders nothing before the session).
  const [shop] = useState(() => (typeof window === "undefined" ? null : shopOf(resume.peek())));
  const fromShopify = shop !== null;
  const [name, setName] = useState(shop ?? "");
  const [country, setCountry] = useState<Schemas["CreateTenant"]["country"]>("EG");
  const [agreed, setAgreed] = useState(false);
  // The plan and billing the pricing page chose (kept in this tab since sign-up, re-validated on read).
  const [intent] = useState(() => (typeof window === "undefined" ? null : signupIntent.read()));
  // One key per attempt: a retried create (network, 5xx) never makes two stores.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  /** Into the store: back where the person was sent from (a Shopify install), else a new store starts its setup. */
  async function open(tenantId: string, created: boolean) {
    await refreshMe();
    selectStore(tenantId);
    router.replace(resume.take() ?? (created ? "/onboarding" : "/"));
  }

  const accept = useMutation({
    mutationFn: (inv: MyInvitation) => ok(api.POST("/v1/invitations/{id}/accept", { params: { path: { id: inv.id } } })),
    onSuccess: (r) => open(r.tenantId, false),
    onError: () => void refreshMe(), // gone or expired: the list updates
  });
  const create = useMutation({
    mutationFn: () => ok(api.POST("/v1/tenants", { body: {
      name: name.trim(), country, language: locale === "en" ? "en" : "ar", acceptLegal: { terms: LEGAL_VERSIONS.terms, dpa: LEGAL_VERSIONS.dpa },
      // The tier and billing the pricing page chose (E12-2a2): nothing without a choice (a Growth monthly trial).
      ...trialChoice(intent),
    }, headers: idempotency(idempotencyKey) })),
    onSuccess: (tenant) => { signupIntent.clear(); return open(tenant.id, true); },
    // A refused create (4xx) is final for this key; the next try is a new attempt.
    onError: (err) => { if (err instanceof ApiError && err.status >= 400 && err.status < 500) setIdempotencyKey(crypto.randomUUID()); },
    meta: { toast: false }, // shown in the form
  });
  const busy = accept.isPending ? accept.variables?.id ?? null : create.isPending ? "create" : null;
  const createError = create.error instanceof ApiError && create.error.code === "tenant_limit_reached" ? "tenantLimit" : create.error ? "generic" : null;
  const versionChanged = isLegalVersionChanged(create.error);

  if (!user || !me) return null;
  const who = me.user.email ?? me.user.phone ?? "";

  const onCreate = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <Step>
      <AuthHeading title={t("title")} body={t("subtitle")} brief />

      {me.invitations.length > 0 ? (
        <section className="rounded-lg bg-surface-sunk p-[clamp(12px,2vh,20px)]" aria-labelledby="invites">
          <h2 id="invites" className="text-heading-sm">{t("invitations.title")}</h2>
          <ul className="mt-2 flex max-h-[24vh] flex-col divide-y divide-line overflow-y-auto">
            {me.invitations.map((inv) => (
              <li key={inv.id} className="flex items-center gap-3 py-[clamp(6px,1.2vh,12px)]">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-label">{inv.tenantName}</p>
                  <p className="text-caption text-text-3">
                    {tr(inv.role)}
                    <span aria-hidden="true" className="mx-1.5">{"·"}</span>
                    {t("invitations.expires", { date: format.dateTime(new Date(inv.expiresAt), { dateStyle: "medium", numberingSystem: "latn" }) })}
                  </p>
                </div>
                <Button variant="secondary" busy={busy === inv.id} disabled={busy !== null} onClick={() => accept.mutate(inv)}>{t("invitations.accept")}</Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="create">
        <h2 id="create" className="text-heading-sm">{t("create.title")}</h2>
        {intent ? <div className="mt-2"><TrialChip plan={intent.plan} interval={intent.interval} enterprise={intent.enterprise} /></div> : null}
        <form onSubmit={onCreate} className="mt-(--_gap) flex flex-col gap-(--_gap)">
          <Field label={t("create.name")} hint={t(fromShopify ? "create.nameFromShopify" : "create.nameHint")} required minLength={2} maxLength={80} name="store" autoComplete="organization"
            value={name} onChange={(e) => setName(e.target.value)} />
          <div className="flex flex-col gap-1.5">
            <label htmlFor={countryId} className="text-label text-text">{t("create.country")}</label>
            <select id={countryId} value={country} onChange={(e) => setCountry(e.target.value as typeof country)} aria-describedby={`${countryId}-hint`}
              className="mz-select">
              {COUNTRY_CODES.map((c) => <option key={c} value={c}>{tc(c)}</option>)}
            </select>
            <p id={`${countryId}-hint`} className="text-caption text-text-3 [@media(max-height:760px)]:hidden">{t("create.countryHint")}</p>
          </div>
          <Checkbox required checked={agreed} onChange={(e) => setAgreed(e.target.checked)} data-testid="accept-legal"
            label={<span className="text-body-sm">{tl.rich("agree", { terms: (c) => <LegalLink doc="terms">{c}</LegalLink>, dpa: (c) => <LegalLink doc="dpa">{c}</LegalLink> })}</span>} />
          {versionChanged ? <Alert tone="warning">{tl("versionChanged")}</Alert> : createError ? <Alert tone="danger">{t(`errors.${createError}`)}</Alert> : null}
          <Button type="submit" size="lg" busy={busy === "create"} disabled={busy !== null || name.trim().length < 2 || !agreed}>{t("create.submit")}</Button>
        </form>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2 text-caption text-text-3">
        <span>{t.rich("signedInAs", { who, n: (c) => <Bdi code>{c}</Bdi> })}</span>
        <Button variant="ghost" onClick={() => void signOut()}>{ts("signOut")}</Button>
      </div>
    </Step>
  );
}

/** The shop a Shopify install came from ("nile-abayas.myshopify.com" → "Nile Abayas"), until Shopify's own name arrives. */
function shopOf(path: string | null): string | null {
  if (!path) return null;
  const shop = new URLSearchParams(path.split("?")[1] ?? "").get("shop");
  const handle = /^([a-z0-9][a-z0-9-]*)\.myshopify\.com$/i.exec(shop ?? "")?.[1];
  return handle ? handle.split("-").filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ").slice(0, 80) : null;
}

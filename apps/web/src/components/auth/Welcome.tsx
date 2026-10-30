"use client";

import { COUNTRY_CODES } from "@mizan/shared";
import { useMutation } from "@tanstack/react-query";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";
import { Bdi } from "@/components/Bdi";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { useRouter } from "@/i18n/navigation";
import { AuthHeading, Step } from "./kit";
import { ApiError, idempotency, ok, type MyInvitation, type Schemas } from "@/lib/api/client";
import { useSession } from "@/lib/session";

/**
 * After sign-in without a store: join a store you were invited to (the API matches the invitation
 * to your verified email or phone), or create one (you become its owner).
 */
export function Welcome() {
  const t = useTranslations("welcome");
  const tr = useTranslations("roles");
  const tc = useTranslations("countries");
  const ts = useTranslations("shell");
  const format = useFormatter();
  const locale = useLocale();
  const router = useRouter();
  const { user, me, api, refreshMe, selectStore, signOut } = useSession();
  const countryId = useId();

  const [name, setName] = useState("");
  const [country, setCountry] = useState<Schemas["CreateTenant"]["country"]>("EG");
  // One key per attempt: a retried create (network, 5xx) never makes two stores.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  async function open(tenantId: string) {
    await refreshMe();
    selectStore(tenantId);
    router.replace("/");
  }

  const accept = useMutation({
    mutationFn: (inv: MyInvitation) => ok(api.POST("/v1/invitations/{id}/accept", { params: { path: { id: inv.id } } })),
    onSuccess: (r) => open(r.tenantId),
    onError: () => void refreshMe(), // gone or expired: the list updates
  });
  const create = useMutation({
    mutationFn: () => ok(api.POST("/v1/tenants", { body: { name: name.trim(), country, language: locale === "en" ? "en" : "ar" }, headers: idempotency(idempotencyKey) })),
    onSuccess: (tenant) => open(tenant.id),
    // A refused create (4xx) is final for this key; the next try is a new attempt.
    onError: (err) => { if (err instanceof ApiError && err.status >= 400 && err.status < 500) setIdempotencyKey(crypto.randomUUID()); },
    meta: { toast: false }, // shown in the form
  });
  const busy = accept.isPending ? accept.variables?.id ?? null : create.isPending ? "create" : null;
  const createError = create.error instanceof ApiError && create.error.code === "tenant_limit_reached" ? "tenantLimit" : create.error ? "generic" : null;

  if (!user || !me) return null;
  const who = me.user.email ?? me.user.phone ?? "";

  const onCreate = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <Step>
      <AuthHeading title={t("title")} body={t("subtitle")} />

      {me.invitations.length > 0 ? (
        <section className="rounded-lg bg-surface-sunk p-5" aria-labelledby="invites">
          <h2 id="invites" className="text-heading-sm">{t("invitations.title")}</h2>
          <ul className="mt-3 flex flex-col divide-y divide-line">
            {me.invitations.map((inv) => (
              <li key={inv.id} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-label">{inv.tenantName}</p>
                  <p className="text-caption text-text-3">
                    {tr(inv.role)}
                    <span aria-hidden="true" className="mx-1.5">{"·"}</span>
                    {t("invitations.expires", { date: format.dateTime(new Date(inv.expiresAt), { dateStyle: "medium" }) })}
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
        <form onSubmit={onCreate} className="mt-4 flex flex-col gap-4">
          <Field label={t("create.name")} className="[&_input]:h-11" required minLength={2} maxLength={80} name="store" autoComplete="organization"
            value={name} onChange={(e) => setName(e.target.value)} />
          <div className="flex flex-col gap-1.5">
            <label htmlFor={countryId} className="text-label text-text">{t("create.country")}</label>
            <select id={countryId} value={country} onChange={(e) => setCountry(e.target.value as typeof country)} aria-describedby={`${countryId}-hint`}
              className="mz-select h-11">
              {COUNTRY_CODES.map((c) => <option key={c} value={c}>{tc(c)}</option>)}
            </select>
            <p id={`${countryId}-hint`} className="text-caption text-text-3">{t("create.countryHint")}</p>
          </div>
          {createError ? <Alert tone="danger">{t(`errors.${createError}`)}</Alert> : null}
          <Button type="submit" size="lg" busy={busy === "create"} disabled={busy !== null || name.trim().length < 2}>{t("create.submit")}</Button>
        </form>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2 text-caption text-text-3">
        <span>{t.rich("signedInAs", { who, n: (c) => <Bdi code>{c}</Bdi> })}</span>
        <Button variant="ghost" onClick={() => void signOut()}>{ts("signOut")}</Button>
      </div>
    </Step>
  );
}

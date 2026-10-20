"use client";

import { COUNTRY_CODES } from "@mizan/shared";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";
import { Bdi } from "@/components/Bdi";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { useRouter } from "@/i18n/navigation";
import { api, ApiError, type MyInvitation } from "@/lib/api";
import { useSession } from "@/lib/session";

interface CreatedTenant { id: string }

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
  const { user, me, refreshMe, selectStore, signOut } = useSession();
  const countryId = useId();

  const [name, setName] = useState("");
  const [country, setCountry] = useState<string>("EG");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<"tenantLimit" | "generic" | null>(null);
  // One key per attempt: a retried click after a timeout never creates two stores.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  if (!user || !me) return null;
  const who = me.user.email ?? me.user.phone ?? "";

  async function open(tenantId: string) {
    await refreshMe();
    selectStore(tenantId);
    router.replace("/");
  }

  const accept = async (inv: MyInvitation) => {
    setBusy(inv.id);
    setError(null);
    try {
      const r = await api<{ tenantId: string }>(user, `/invitations/${inv.id}/accept`, { method: "POST", locale });
      await open(r.tenantId);
    } catch {
      setError("generic");
      await refreshMe();
    } finally {
      setBusy(null);
    }
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy("create");
    setError(null);
    try {
      const tenant = await api<CreatedTenant>(user, "/tenants", { method: "POST", locale, idempotencyKey, body: { name: name.trim(), country, language: locale } });
      await open(tenant.id);
    } catch (err) {
      setError(err instanceof ApiError && err.code === "tenant_limit_reached" ? "tenantLimit" : "generic");
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) setIdempotencyKey(crypto.randomUUID());
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-heading-lg">{t("title")}</h1>
        <p className="mt-1.5 text-body-sm text-text-2">{t("subtitle")}</p>
      </div>

      {me.invitations.length > 0 ? (
        <section className="rounded-lg border border-line bg-surface p-5" aria-labelledby="invites">
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
                <Button variant="secondary" busy={busy === inv.id} disabled={busy !== null} onClick={() => void accept(inv)}>{t("invitations.accept")}</Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-lg border border-line bg-surface p-5" aria-labelledby="create">
        <h2 id="create" className="text-heading-sm">{t("create.title")}</h2>
        <form onSubmit={create} className="mt-4 flex flex-col gap-4">
          <Field label={t("create.name")} required minLength={2} maxLength={80} name="store" autoComplete="organization"
            value={name} onChange={(e) => setName(e.target.value)} />
          <div className="flex flex-col gap-1.5">
            <label htmlFor={countryId} className="text-label text-text">{t("create.country")}</label>
            <select id={countryId} value={country} onChange={(e) => setCountry(e.target.value)} aria-describedby={`${countryId}-hint`}
              className="h-9 rounded-sm border border-line-strong bg-surface px-3 text-body text-text hover:border-text-3 focus-visible:border-focus focus-visible:ring-1 focus-visible:ring-focus">
              {COUNTRY_CODES.map((c) => <option key={c} value={c}>{tc(c)}</option>)}
            </select>
            <p id={`${countryId}-hint`} className="text-caption text-text-3">{t("create.countryHint")}</p>
          </div>
          {error ? <Alert tone="danger">{t(`errors.${error}`)}</Alert> : null}
          <Button type="submit" busy={busy === "create"} disabled={busy !== null || name.trim().length < 2}>{t("create.submit")}</Button>
        </form>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2 text-caption text-text-3">
        <span>{t.rich("signedInAs", { who, n: (c) => <Bdi code>{c}</Bdi> })}</span>
        <Button variant="ghost" onClick={() => void signOut()}>{ts("signOut")}</Button>
      </div>
    </div>
  );
}

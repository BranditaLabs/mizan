"use client";

import { Icon } from "@mizan/design-system/icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Bdi } from "@/components/Bdi";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Card } from "@/components/ui/Surface";
import { When } from "@/components/ui/When";
import { ApiError, ok } from "@/lib/api/client";
import { useSession } from "@/lib/session";

const KNOWN = new Set(["domain_taken", "public_email_domain", "validation_failed"]);

/**
 * Company sign-in for one store (A-9). Every staff member sees which domains sign in through the
 * store's identity provider; a super admin adds one (after creating the provider in Firebase
 * Identity Platform and verifying the domain with the store), pauses it or removes it. Each change
 * is in the store's audit log with the reason.
 */
export function StoreSso({ storeId }: { storeId: string }) {
  const t = useTranslations("store.sso");
  const qc = useQueryClient();
  const { api, can } = useSession();
  const key = ["store-sso", storeId];
  const q = useQuery({ queryKey: key, queryFn: () => ok(api.GET("/v1/platform/stores/{storeId}/sso", { params: { path: { storeId } } })) });
  const [form, setForm] = useState({ domain: "", providerId: "", reason: "" });
  const refresh = () => void qc.invalidateQueries({ queryKey: key });

  const save = useMutation({
    mutationFn: (v: { domain: string; providerId: string; enabled: boolean; reason: string }) =>
      ok(api.PUT("/v1/platform/stores/{storeId}/sso/{domain}", { params: { path: { storeId, domain: v.domain } }, body: { providerId: v.providerId, enabled: v.enabled, reason: v.reason } })),
    onSuccess: () => { setForm({ domain: "", providerId: "", reason: "" }); refresh(); },
  });
  const remove = useMutation({
    mutationFn: (domain: string) => ok(api.DELETE("/v1/platform/stores/{storeId}/sso/{domain}", { params: { path: { storeId, domain } }, body: {} })),
    onSuccess: refresh,
  });

  const admin = can("super_admin");
  const ready = form.domain.trim() && /^(saml|oidc)\.[a-z0-9-]+$/.test(form.providerId.trim()) && form.reason.trim().length >= 3;
  const onAdd = (e: FormEvent) => {
    e.preventDefault();
    if (ready) save.mutate({ domain: form.domain.trim().toLowerCase(), providerId: form.providerId.trim(), enabled: true, reason: form.reason.trim() });
  };
  const failure = save.error ?? remove.error;
  const code = failure instanceof ApiError && KNOWN.has(failure.code) ? failure.code : "generic";

  return (
    <Card title={t("title")}>
      <p className="text-body-sm text-text-2">{t("intro")}</p>
      {q.isError ? <Alert tone="danger">{t("loadFailed")}</Alert> : null}
      {q.data?.data.length ? (
        <ul className="mt-3 flex flex-col divide-y divide-line" data-testid="store-sso">
          {q.data.data.map((d) => (
            <li key={d.domain} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="flex flex-wrap items-center gap-2">
                <Bdi code>{d.domain}</Bdi>
                <Icon name="forward" size={14} className="text-text-3" aria-hidden="true" />
                <Bdi code>{d.providerId}</Bdi>
                <Badge tone={d.enabled ? "success" : "neutral"}>{d.enabled ? t("on") : t("paused")}</Badge>
              </span>
              <span className="flex items-center gap-2 text-caption text-text-2">
                <When value={d.updatedAt} />
                {admin ? (
                  <>
                    <Button size="sm" variant="secondary" busy={save.isPending && save.variables?.domain === d.domain}
                      onClick={() => save.mutate({ domain: d.domain, providerId: d.providerId, enabled: !d.enabled, reason: d.enabled ? t("pausedReason") : t("resumedReason") })}>
                      {d.enabled ? t("pause") : t("resume")}
                    </Button>
                    <Button size="sm" variant="danger" busy={remove.isPending && remove.variables === d.domain} onClick={() => remove.mutate(d.domain)}>{t("remove")}</Button>
                  </>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : q.data ? <p className="mt-3 text-body-sm text-text-2">{t("none")}</p> : null}

      {admin ? (
        <form onSubmit={onAdd} className="mt-4 grid gap-3 md:grid-cols-3" noValidate>
          <Field label={t("domain")} ltr placeholder="acme.com" value={form.domain} maxLength={253} name="ssoDomain" onChange={(e) => setForm({ ...form, domain: e.target.value })} />
          <Field label={t("provider")} hint={t("providerHint")} ltr placeholder="saml.acme" value={form.providerId} maxLength={65} name="ssoProvider" onChange={(e) => setForm({ ...form, providerId: e.target.value })} />
          <Field label={t("reason")} hint={t("reasonHint")} value={form.reason} maxLength={500} name="ssoReason" onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          <div className="md:col-span-3"><Button type="submit" variant="secondary" busy={save.isPending && save.variables?.domain === form.domain.trim().toLowerCase()} disabled={!ready}>{t("add")}</Button></div>
        </form>
      ) : null}
      {failure ? <div className="mt-3"><Alert tone="danger">{t(`errors.${code}`)}</Alert></div> : null}
    </Card>
  );
}

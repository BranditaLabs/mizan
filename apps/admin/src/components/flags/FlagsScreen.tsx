"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Bdi } from "@/components/Bdi";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Choice";
import { Field } from "@/components/ui/Field";
import { ok } from "@/lib/api/client";
import { useSession } from "@/lib/session";

/** A-6: flags for everyone and per store (a store's own setting wins). Super admins and engineers change them. */
export function FlagsScreen() {
  const t = useTranslations("flags");
  const qc = useQueryClient();
  const { api, can } = useSession();
  const editable = can("super_admin", "engineer");
  const q = useQuery({ queryKey: ["flags"], queryFn: () => ok(api.GET("/v1/platform/flags")) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["flags"] });
  const put = useMutation({ mutationFn: (b: { key: string; enabled: boolean; description?: string }) => ok(api.PUT("/v1/platform/flags/{key}", { params: { path: { key: b.key } }, body: { enabled: b.enabled, ...(b.description !== undefined ? { description: b.description } : {}) } })), onSettled: refresh });
  const putStore = useMutation({ mutationFn: (b: { key: string; storeId: string; enabled: boolean }) => ok(api.PUT("/v1/platform/flags/{key}/stores/{storeId}", { params: { path: { key: b.key, storeId: b.storeId } }, body: { enabled: b.enabled } })), onSettled: refresh });
  const clearStore = useMutation({ mutationFn: (b: { key: string; storeId: string }) => ok(api.DELETE("/v1/platform/flags/{key}/stores/{storeId}", { params: { path: b } })), onSettled: refresh });
  const remove = useMutation({ mutationFn: (key: string) => ok(api.DELETE("/v1/platform/flags/{key}", { params: { path: { key } } })), onSettled: refresh });
  const [draft, setDraft] = useState({ key: "", description: "" });
  const [storeFor, setStoreFor] = useState<Record<string, string>>({});

  const onCreate = (e: FormEvent) => {
    e.preventDefault();
    put.mutate({ key: draft.key.trim(), enabled: false, description: draft.description.trim() }, { onSuccess: () => setDraft({ key: "", description: "" }) });
  };

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="font-display text-heading-lg">{t("title")}</h1>
        <p className="text-body-sm text-text-2">{t("subtitle")}</p>
      </header>
      {editable ? (
        <form onSubmit={onCreate} className="grid gap-3 rounded-lg border border-line bg-surface p-4 md:grid-cols-3" noValidate>
          <Field label={t("key")} hint={t("keyHint")} ltr value={draft.key} name="key" onChange={(e) => setDraft({ ...draft, key: e.target.value })} />
          <Field label={t("description")} value={draft.description} maxLength={500} name="description" onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          <div className="flex items-end"><Button type="submit" variant="secondary" busy={put.isPending} disabled={!/^[a-z][a-z0-9_.]{2,60}$/.test(draft.key.trim())}>{t("create")}</Button></div>
        </form>
      ) : null}
      <ul className="flex flex-col gap-3" data-testid="flags">
        {(q.data?.data ?? []).map((f) => (
          <li key={f.key} className="rounded-lg border border-line bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium"><Bdi code>{f.key}</Bdi></p>
                {f.description ? <p className="text-body-sm text-text-2">{f.description}</p> : null}
              </div>
              <div className="flex items-center gap-3">
                <Switch label={t("everyone")} checked={f.enabled} disabled={!editable} onChange={(e) => put.mutate({ key: f.key, enabled: e.target.checked })} />
                {editable ? <Button size="sm" variant="ghost" onClick={() => remove.mutate(f.key)}>{t("delete")}</Button> : null}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {f.stores.map((s) => (
                <span key={s.storeId} className="inline-flex items-center gap-1">
                  <Badge tone={s.enabled ? "success" : "neutral"}>{t(s.enabled ? "storeOn" : "storeOff", { store: s.storeName })}</Badge>
                  {editable ? <Button size="sm" variant="ghost" onClick={() => clearStore.mutate({ key: f.key, storeId: s.storeId })}>{t("clear")}</Button> : null}
                </span>
              ))}
            </div>
            {editable ? (
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <Field label={t("storeId")} ltr value={storeFor[f.key] ?? ""} name={`store-${f.key}`} onChange={(e) => setStoreFor({ ...storeFor, [f.key]: e.target.value })} />
                <Button size="sm" variant="secondary" disabled={!(storeFor[f.key] ?? "").trim()} onClick={() => putStore.mutate({ key: f.key, storeId: storeFor[f.key]!.trim(), enabled: true })}>{t("onForStore")}</Button>
                <Button size="sm" variant="secondary" disabled={!(storeFor[f.key] ?? "").trim()} onClick={() => putStore.mutate({ key: f.key, storeId: storeFor[f.key]!.trim(), enabled: false })}>{t("offForStore")}</Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {q.data && !q.data.data.length ? <p className="text-body-sm text-text-2">{t("none")}</p> : null}
    </div>
  );
}

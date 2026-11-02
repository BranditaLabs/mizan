"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Bdi } from "@/components/Bdi";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field, SearchInput } from "@/components/ui/Field";
import { Card } from "@/components/ui/Surface";
import { When } from "@/components/ui/When";
import { Link } from "@/i18n/navigation";
import { ok } from "@/lib/api/client";
import { useSession } from "@/lib/session";

/** A-5: find a person, see their stores, stop or allow their sign-in (super admin). */
export function UsersScreen() {
  const t = useTranslations("users");
  const qc = useQueryClient();
  const { api, can } = useSession();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const query = { ...(q.trim().length >= 2 ? { q: q.trim() } : {}), limit: 50 };
  const list = useQuery({ queryKey: ["users", query], queryFn: () => ok(api.GET("/v1/platform/users", { params: { query } })), placeholderData: keepPreviousData });
  const detail = useQuery({ queryKey: ["user", open], queryFn: () => ok(api.GET("/v1/platform/users/{id}", { params: { path: { id: open! } } })), enabled: Boolean(open) });
  const done = () => { setReason(""); void qc.invalidateQueries({ queryKey: ["users"] }); void qc.invalidateQueries({ queryKey: ["user", open] }); };
  const disable = useMutation({ mutationFn: (id: string) => ok(api.POST("/v1/platform/users/{id}/disable", { params: { path: { id } }, body: { reason: reason.trim() } })), onSuccess: done });
  const enable = useMutation({ mutationFn: (id: string) => ok(api.POST("/v1/platform/users/{id}/enable", { params: { path: { id } } })), onSuccess: done });
  const u = detail.data;

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="font-display text-heading-lg">{t("title")}</h1>
        <p className="text-body-sm text-text-2">{t("subtitle")}</p>
      </header>
      <SearchInput label={t("search")} placeholder={t("search")} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="grid gap-5 lg:grid-cols-5">
        <div className="mz-table-wrap lg:col-span-3">
          <table className="mz-table" data-testid="users-table">
            <thead><tr><th>{t("col.person")}</th><th>{t("col.stores")}</th><th>{t("col.status")}</th><th>{t("col.joined")}</th></tr></thead>
            <tbody>
              {(list.data?.data ?? []).map((p) => (
                <tr key={p.id} aria-selected={open === p.id}>
                  <td>
                    <button type="button" className="text-start font-medium underline-offset-2 hover:underline" onClick={() => setOpen(p.id)}>{p.name ?? p.email ?? p.phone ?? p.id}</button>
                    <div className="text-caption text-text-2"><Bdi code>{p.email ?? p.phone ?? ""}</Bdi></div>
                  </td>
                  <td><Bdi>{p.stores}</Bdi></td>
                  <td className="flex flex-wrap gap-1">
                    {p.disabled ? <Badge tone="danger">{t("disabled")}</Badge> : <Badge tone="success">{t("active")}</Badge>}
                    {p.staffRole ? <Badge tone="ink">{t("staff")}</Badge> : null}
                  </td>
                  <td><When value={p.createdAt} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="lg:col-span-2">
          {u ? (
            <Card title={u.name ?? u.email ?? u.phone ?? u.id}>
              <div className="flex flex-col gap-3 text-body-sm" data-testid="user-detail">
                <p><Bdi code>{u.email ?? ""}</Bdi> <Bdi code>{u.phone ?? ""}</Bdi></p>
                {u.disabled ? <p className="text-danger-text">{t.rich("disabledSince", { reason: u.disabled.reason, b: (c) => <Bdi>{c}</Bdi> })}</p> : null}
                <h3 className="text-heading-sm">{t("memberships")}</h3>
                <ul className="flex flex-col gap-1">
                  {u.memberships.map((m) => (
                    <li key={m.storeId} className="flex justify-between gap-2">
                      <Link href={`/stores/${m.storeId}`} className="underline-offset-2 hover:underline">{m.storeName}</Link>
                      <Badge>{m.role}</Badge>
                    </li>
                  ))}
                  {!u.memberships.length ? <li className="text-text-2">{t("noStores")}</li> : null}
                </ul>
                {can("super_admin") ? (
                  u.disabled ? (
                    <Button busy={enable.isPending} onClick={() => enable.mutate(u.id)}>{t("enable")}</Button>
                  ) : (
                    <>
                      <Field label={t("reason")} hint={t("reasonHint")} value={reason} maxLength={500} name="reason" onChange={(e) => setReason(e.target.value)} />
                      <Button variant="danger" disabled={reason.trim().length < 3} busy={disable.isPending} onClick={() => disable.mutate(u.id)}>{t("disable")}</Button>
                    </>
                  )
                ) : null}
              </div>
            </Card>
          ) : <p className="text-body-sm text-text-2">{t("pick")}</p>}
        </div>
      </div>
    </div>
  );
}

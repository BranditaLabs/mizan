"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Bdi } from "@/components/Bdi";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field, Select } from "@/components/ui/Field";
import { ok, type StaffRole } from "@/lib/api/client";
import { useSession } from "@/lib/session";

const ROLES: StaffRole[] = ["super_admin", "support", "finance", "engineer"];

/** A-1/A-5: who is on the Mizan staff and with which role (super admins). Mizan always keeps an active super admin. */
export function StaffScreen() {
  const t = useTranslations("staff");
  const tr = useTranslations("shell.roles");
  const qc = useQueryClient();
  const { api, staff: me } = useSession();
  const q = useQuery({ queryKey: ["staff"], queryFn: () => ok(api.GET("/v1/platform/staff")) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["staff"] });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("support");
  const add = useMutation({ mutationFn: () => ok(api.POST("/v1/platform/staff", { body: { email: email.trim(), role } })), onSuccess: () => { setEmail(""); void refresh(); } });
  const update = useMutation({
    mutationFn: (b: { id: string; role?: StaffRole; status?: "active" | "disabled" }) => ok(api.PATCH("/v1/platform/staff/{id}", { params: { path: { id: b.id } }, body: { ...(b.role ? { role: b.role } : {}), ...(b.status ? { status: b.status } : {}) } })),
    onSettled: refresh,
  });
  const onAdd = (e: FormEvent) => { e.preventDefault(); if (email.trim()) add.mutate(); };

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="font-display text-heading-lg">{t("title")}</h1>
        <p className="text-body-sm text-text-2">{t("subtitle")}</p>
      </header>
      <form onSubmit={onAdd} className="grid gap-3 rounded-lg border border-line bg-surface p-4 md:grid-cols-3" noValidate>
        <Field label={t("email")} hint={t("emailHint")} type="email" ltr value={email} name="email" onChange={(e) => setEmail(e.target.value)} />
        <Select label={t("role")} value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
          {ROLES.map((r) => <option key={r} value={r}>{tr(r)}</option>)}
        </Select>
        <div className="flex items-end"><Button type="submit" variant="secondary" busy={add.isPending} disabled={!email.trim()}>{t("add")}</Button></div>
      </form>
      <div className="mz-table-wrap">
        <table className="mz-table" data-testid="staff-table">
          <thead><tr><th>{t("col.person")}</th><th>{t("col.role")}</th><th>{t("col.status")}</th><th /></tr></thead>
          <tbody>
            {(q.data?.data ?? []).map((s) => (
              <tr key={s.id}>
                <td><span className="font-medium">{s.name ?? "—"}</span> <Bdi code>{s.email ?? ""}</Bdi></td>
                <td>
                  <Select label={t("role")} value={s.role} disabled={s.id === me?.id} onChange={(e) => update.mutate({ id: s.id, role: e.target.value as StaffRole })}>
                    {ROLES.map((r) => <option key={r} value={r}>{tr(r)}</option>)}
                  </Select>
                </td>
                <td><Badge tone={s.status === "active" ? "success" : "neutral"}>{t(`status.${s.status}`)}</Badge></td>
                <td>
                  {s.id !== me?.id ? (
                    <Button size="sm" variant="secondary" onClick={() => update.mutate({ id: s.id, status: s.status === "active" ? "disabled" : "active" })}>
                      {s.status === "active" ? t("disable") : t("enable")}
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

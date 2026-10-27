"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Bdi } from "@/components/Bdi";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Choice";
import { Field, Select } from "@/components/ui/Field";
import { EmptyState, SkeletonRows } from "@/components/ui/Surface";
import { useToast } from "@/components/ui/Toast";
import { DateText } from "@/components/ui/Values";
import { ok, type MemberRole } from "@/lib/api/client";
import { useSession } from "@/lib/session";
import { SettingsTabs } from "./SettingsTabs";

const ROLES: MemberRole[] = ["owner", "admin", "ops_manager", "agent", "warehouse", "finance", "media_buyer"];
const EDITORS = new Set(["owner", "admin"]);

/**
 * Settings → Team (A-8, on E1-7): who works in the store and what each may do. Invite by email or
 * phone (the link only works for that email or number), change a role, disable or remove someone,
 * revoke an invitation. Owners and admins; only an owner can make or change an owner (the API checks).
 */
export function TeamScreen() {
  const t = useTranslations("team");
  const tr = useTranslations("roles");
  const { api, user, store, me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const role = store?.role ?? "";
  const key = ["team", user?.uid ?? "", store?.tenantId ?? ""];
  const q = useQuery({ queryKey: key, queryFn: () => ok(api.GET("/v1/members")), enabled: EDITORS.has(role) });
  const done = (message: string) => { toast({ message }); void qc.invalidateQueries({ queryKey: key }); };

  const [via, setVia] = useState<"email" | "phone">("phone");
  const [contact, setContact] = useState("");
  const [inviteRole, setInviteRole] = useState<MemberRole>("agent");
  const invite = useMutation({
    mutationFn: () => ok(api.POST("/v1/members/invite", { body: { [via]: contact.trim(), role: inviteRole } })),
    onSuccess: () => { setContact(""); done(t("invited")); },
  });
  const update = useMutation({
    mutationFn: (b: { userId: string; role?: MemberRole; status?: "active" | "disabled" }) =>
      ok(api.PATCH("/v1/members/{userId}", { params: { path: { userId: b.userId } }, body: { ...(b.role ? { role: b.role } : {}), ...(b.status ? { status: b.status } : {}) } })),
    onSuccess: () => done(t("saved")),
  });
  const remove = useMutation({
    mutationFn: (userId: string) => ok(api.DELETE("/v1/members/{userId}", { params: { path: { userId } } })),
    onSuccess: () => done(t("removed")),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => ok(api.DELETE("/v1/invitations/{id}", { params: { path: { id } } })),
    onSuccess: () => done(t("revoked")),
  });
  const onInvite = (e: FormEvent) => { e.preventDefault(); if (contact.trim()) invite.mutate(); };
  const myId = me?.user.id;

  const header = (
    <header>
      <h1 className="font-display text-heading-lg">{t("title")}</h1>
      <p className="mt-1 max-w-[70ch] text-body-sm text-text-2">{t("subtitle")}</p>
    </header>
  );
  if (!EDITORS.has(role)) {
    return <Frame>{header}<div className="mz-card"><EmptyState icon="locked" title={t("notAllowed.title")} body={t("notAllowed.body")} /></div></Frame>;
  }
  const pending = (q.data?.invitations ?? []).filter((i) => i.status === "pending");
  return (
    <Frame>
      {header}
      <form onSubmit={onInvite} className="mz-card grid gap-3 p-5 md:grid-cols-4" noValidate data-testid="invite-form">
        <div className="md:col-span-4">
          <Segmented label={t("inviteBy")} value={via} options={(["phone", "email"] as const).map((v) => ({ value: v, label: t(`via.${v}`) }))} onChange={(v) => { setVia(v); setContact(""); }} />
        </div>
        <Field className="md:col-span-2" label={t(`via.${via}`)} type={via === "email" ? "email" : "tel"} ltr name="contact" value={contact} onChange={(e) => setContact(e.target.value)}
          hint={via === "phone" ? t("phoneHint") : undefined} />
        <Select label={t("role")} value={inviteRole} onChange={(e) => setInviteRole(e.target.value as MemberRole)}>
          {ROLES.filter((r) => r !== "owner" || role === "owner").map((r) => <option key={r} value={r}>{tr(r)}</option>)}
        </Select>
        <div className="flex items-end"><Button type="submit" busy={invite.isPending} disabled={!contact.trim()}>{t("invite")}</Button></div>
      </form>

      {!q.data ? <div className="mz-card"><SkeletonRows rows={3} label={t("loading")} /></div> : (
        <>
          <div className="mz-table-wrap">
            <table className="mz-table" data-testid="team-table">
              <thead><tr><th>{t("col.person")}</th><th>{t("col.role")}</th><th>{t("col.status")}</th><th>{t("col.joined")}</th><th /></tr></thead>
              <tbody>
                {q.data.members.map((m) => {
                  const self = m.userId === myId;
                  return (
                    <tr key={m.userId}>
                      <td><span className="font-medium">{m.displayName ?? "—"}</span><div className="text-caption text-text-2"><Bdi code>{m.email ?? m.phone ?? ""}</Bdi></div></td>
                      <td>
                        <Select label={t("role")} value={m.role} disabled={self || (m.role === "owner" && role !== "owner")}
                          onChange={(e) => update.mutate({ userId: m.userId, role: e.target.value as MemberRole })}>
                          {ROLES.filter((r) => r !== "owner" || role === "owner" || m.role === "owner").map((r) => <option key={r} value={r}>{tr(r)}</option>)}
                        </Select>
                      </td>
                      <td><Badge tone={m.status === "active" ? "success" : "neutral"}>{t(`status.${m.status}`)}</Badge></td>
                      <td><DateText value={m.joinedAt} /></td>
                      <td>
                        {self ? <span className="text-caption text-text-2">{t("you")}</span> : (
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" onClick={() => update.mutate({ userId: m.userId, status: m.status === "active" ? "disabled" : "active" })}>
                              {m.status === "active" ? t("disable") : t("enable")}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => remove.mutate(m.userId)}>{t("remove")}</Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <section className="mz-card p-5">
            <h2 className="text-heading-sm">{t("pending")}</h2>
            {pending.length ? (
              <ul className="mt-3 flex flex-col divide-y divide-line" data-testid="invitations">
                {pending.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span><Bdi code>{i.email ?? i.phone ?? ""}</Bdi> · {tr(i.role)}</span>
                    <span className="flex items-center gap-2 text-caption text-text-2">
                      {t.rich("expires", { date: () => <DateText value={i.expiresAt} /> })}
                      <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard?.writeText(i.acceptUrl).then(() => toast({ message: t("copied") }))}>{t("copyLink")}</Button>
                      <Button size="sm" variant="ghost" onClick={() => revoke.mutate(i.id)}>{t("revoke")}</Button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-2 text-body-sm text-text-2">{t("noPending")}</p>}
          </section>
        </>
      )}
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex max-w-[960px] flex-col gap-5 px-4 pt-6 pb-14 md:px-6" data-testid="team-settings"><SettingsTabs />{children}</div>;
}

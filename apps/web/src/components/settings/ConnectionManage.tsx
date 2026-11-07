"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Bdi } from "@/components/Bdi";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { ok, type Schemas } from "@/lib/api/client";
import { problemText } from "@/lib/api/query";
import { useSession } from "@/lib/session";

type Connection = Schemas["ConnectionView"];

/**
 * U7: name a store or courier, or stop using it. Disconnecting asks the owner to type the store's
 * address (or the provider's name): Mizan stops syncing and forgets the key; orders and history
 * stay, and it can be connected again. On Shopify the app stays installed until removed there.
 */
export function ConnectionActions({ c }: { c: Connection }) {
  const t = useTranslations("integrationsSettings.manage");
  const [open, setOpen] = useState<"rename" | "disconnect" | null>(null);
  if (c.status === "disconnected") return null;
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen("rename")}>{t("rename")}</Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen("disconnect")}>{t("disconnect")}</Button>
      {open === "rename" ? <Rename c={c} onClose={() => setOpen(null)} /> : null}
      {open === "disconnect" ? <Disconnect c={c} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function Rename({ c, onClose }: { c: Connection; onClose(): void }) {
  const t = useTranslations("integrationsSettings.manage");
  const { api } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(c.displayName ?? "");
  const save = useMutation({
    mutationFn: () => ok(api.PATCH("/v1/connections/{id}", { params: { path: { id: c.id } }, body: { displayName: name.trim() || null } })),
    onSuccess: () => { toast.event({ type: null, message: t("renamed") }); void qc.invalidateQueries({ queryKey: ["connections"] }); onClose(); },
  });
  const tooLong = name.trim().length > 60;
  return (
    <Dialog open onClose={onClose} title={t("renameTitle")} description={t("renameBody")}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>{t("cancel")}</Button>
          <Button busy={save.isPending} disabled={tooLong} onClick={() => save.mutate()}>{t("save")}</Button>
        </>
      )}>
      <Field label={t("name")} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} error={tooLong ? t("tooLong") : null} hint={t("nameHint")} />
    </Dialog>
  );
}

function Disconnect({ c, onClose }: { c: Connection; onClose(): void }) {
  const t = useTranslations("integrationsSettings.manage");
  const tpr = useTranslations("problems");
  const { api } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const expected = c.account ?? c.provider;
  const [typed, setTyped] = useState("");
  const go = useMutation({
    mutationFn: () => ok(api.POST("/v1/connections/{id}/disconnect", { params: { path: { id: c.id } }, body: { confirm: typed.trim() } })),
    meta: { toast: false },
    onSuccess: () => { toast.event({ type: "connection.disconnected", data: { actor: { type: "user" } }, message: t("disconnected") }); void qc.invalidateQueries({ queryKey: ["connections"] }); void qc.invalidateQueries({ queryKey: ["onboarding"] }); onClose(); },
  });
  const matches = typed.trim().toLowerCase() === expected.trim().toLowerCase();
  return (
    <Dialog open onClose={onClose} title={t("disconnectTitle")}
      description={t.rich("disconnectBody", { name: expected, b: (x) => <Bdi code>{x}</Bdi> })}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} data-autofocus>{t("cancel")}</Button>
          <Button variant="danger-solid" busy={go.isPending} disabled={!matches} onClick={() => go.mutate()}>{t("disconnect")}</Button>
        </>
      )}>
      <div className="flex flex-col gap-3" data-testid="disconnect-dialog">
        <ul className="list-disc ps-5 text-body-sm text-text-2">
          <li>{t("effects.stops")}</li>
          <li>{t("effects.keeps")}</li>
          {c.provider === "shopify" ? <li>{t("effects.shopify")}</li> : null}
        </ul>
        <Field label={t("typeToConfirm", { name: expected })} ltr value={typed} onChange={(e) => setTyped(e.target.value)} />
        {go.isError ? <Alert tone="danger">{problemText(go.error, tpr)}</Alert> : null}
      </div>
    </Dialog>
  );
}

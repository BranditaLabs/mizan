"use client";

import { rolesWith } from "@mizan/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button, IconButton } from "@/components/ui/Button";
import { Field, TextArea } from "@/components/ui/Field";
import { ErrorState } from "@/components/ui/QueryState";
import { Card } from "@/components/ui/Surface";
import { DateText } from "@/components/ui/Values";
import { ok } from "@/lib/api/client";
import { problemText } from "@/lib/api/query";
import { useSession } from "@/lib/session";

const WRITERS = rolesWith("orders.handle");
const LEADS = rolesWith("orders.lead");
const TAG = /^[\p{L}\p{N}][\p{L}\p{N} _-]{0,39}$/u;

/** O2: the team's notes on the order, newest first. Only the team sees them; never the store or the customer. */
export function NotesCard({ orderId }: { orderId: string }) {
  const t = useTranslations("orders.notes");
  const tpr = useTranslations("problems");
  const { api, user, store } = useSession();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const key = ["order-notes", user?.uid ?? "", store?.tenantId ?? "", orderId];
  const notes = useQuery({
    queryKey: key,
    queryFn: () => ok(api.GET("/v1/orders/{id}/notes", { params: { path: { id: orderId } } })),
    enabled: Boolean(store),
    meta: { toast: false },
  });
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: key }), qc.invalidateQueries({ queryKey: ["order"] }), qc.invalidateQueries({ queryKey: ["orders"] })]);
  const add = useMutation({
    mutationFn: () => ok(api.POST("/v1/orders/{id}/notes", { params: { path: { id: orderId } }, body: { body: text.trim() } })),
    onSuccess: async () => { setText(""); await refresh(); },
    meta: { toast: false },
  });
  const remove = useMutation({
    mutationFn: (noteId: string) => ok(api.DELETE("/v1/orders/{id}/notes/{noteId}", { params: { path: { id: orderId, noteId } } })),
    onSuccess: refresh,
  });
  const canWrite = WRITERS.has(store?.role ?? "");
  const lead = LEADS.has(store?.role ?? "");
  const list = notes.data?.data ?? [];

  return (
    <Card title={t("title")}>
      <div className="flex flex-col gap-3" data-testid="order-notes">
        {canWrite ? (
          <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) add.mutate(); }}>
            <TextArea label={t("label")} hint={t("hint")} value={text} maxLength={2000} rows={2} onChange={(e) => setText(e.target.value)} />
            {add.isError ? <Alert tone="danger">{problemText(add.error, tpr)}</Alert> : null}
            <div><Button type="submit" size="sm" variant="secondary" icon="note" busy={add.isPending} disabled={!text.trim()}>{t("add")}</Button></div>
          </form>
        ) : null}
        {notes.isError && !notes.data ? <ErrorState compact error={notes.error} onRetry={() => void notes.refetch()} retrying={notes.isRefetching} /> : null}
        {notes.data && list.length === 0 ? <p className="text-body-sm text-text-2">{t("empty")}</p> : null}
        <ul className="flex flex-col divide-y divide-line">
          {list.map((n) => (
            <li key={n.id} className="flex items-start justify-between gap-2 py-2.5">
              <div className="min-w-0">
                <p className="whitespace-pre-wrap break-words text-body-sm">{n.body}</p>
                <p className="mt-1 text-caption text-text-3">
                  {n.mine ? t("you") : n.author?.name ?? t("someone")}{" · "}<DateText value={n.createdAt} />
                </p>
              </div>
              {n.mine || lead ? <IconButton icon="delete" size="sm" label={t("remove")} onClick={() => remove.mutate(n.id)} disabled={remove.isPending} /> : null}
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

/** O2: the order's tags. A Shopify order gets the change too; a store's own tag can be taken off as well. */
export function TagsCard({ orderId, tags }: { orderId: string; tags: string[] }) {
  const t = useTranslations("orders.tags");
  const tpr = useTranslations("problems");
  const { api, store } = useSession();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const change = useMutation({
    mutationFn: (body: { add?: string[]; remove?: string[] }) => ok(api.PATCH("/v1/orders/{id}/tags", { params: { path: { id: orderId } }, body: { add: body.add ?? [], remove: body.remove ?? [] } })),
    onSuccess: async () => { setText(""); await Promise.all([qc.invalidateQueries({ queryKey: ["order"] }), qc.invalidateQueries({ queryKey: ["orders"] })]); },
    meta: { toast: false },
  });
  const canWrite = WRITERS.has(store?.role ?? "");
  const tag = text.trim().toLowerCase();
  const valid = TAG.test(tag);

  return (
    <Card title={t("title")}>
      <div className="flex flex-col gap-3" data-testid="order-tags">
        {tags.length === 0 ? <p className="text-body-sm text-text-2">{t("empty")}</p> : (
          <ul className="flex flex-wrap gap-1.5">
            {tags.map((g) => (
              <li key={g} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-sunk py-0.5 ps-2.5 pe-1 text-body-sm">
                {g}
                {canWrite ? <IconButton icon="close" size="sm" label={t("remove", { tag: g })} disabled={change.isPending} onClick={() => change.mutate({ remove: [g] })} /> : null}
              </li>
            ))}
          </ul>
        )}
        {canWrite ? (
          <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (valid && !tags.includes(tag)) change.mutate({ add: [tag] }); }}>
            <Field label={t("label")} value={text} maxLength={40} onChange={(e) => setText(e.target.value)} className="min-w-0 flex-1"
              error={text && !valid ? t("invalid") : null} />
            <Button type="submit" size="sm" variant="secondary" icon="tag" busy={change.isPending} disabled={!valid || tags.includes(tag)}>{t("add")}</Button>
          </form>
        ) : null}
        {change.isError ? <Alert tone="danger">{problemText(change.error, tpr)}</Alert> : null}
      </div>
    </Card>
  );
}

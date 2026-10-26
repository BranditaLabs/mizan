"use client";

import { Icon } from "@mizan/design-system/icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Badge, Tag } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { IdCell } from "@/components/ui/DataTable";
import { Select, TextArea } from "@/components/ui/Field";
import { Card, EmptyState, KeyValue, SkeletonRows, Timeline } from "@/components/ui/Surface";
import { useToast } from "@/components/ui/Toast";
import { DateText } from "@/components/ui/Values";
import { Link } from "@/i18n/navigation";
import { ApiError, ok, type Schemas } from "@/lib/api/client";
import { problemText } from "@/lib/api/query";
import { useSession } from "@/lib/session";
import { STATUS_TONE, TICKET_REASONS, TICKET_STATUSES, TICKET_TYPES } from "./ticket-ui";

type Ticket = Schemas["Ticket"];
type Patch = Schemas["UpdateTicket"];

/**
 * One ticket (E10-1): what it is about, its order, who has it and by when, and its history.
 * Those who work it change the status, type, reason and assignee; anyone who sees it adds a note.
 */
export function TicketDetail({ id }: { id: string }) {
  const t = useTranslations("tickets");
  const tpr = useTranslations("problem");
  const { api, user, store } = useSession();
  const key = ["ticket", user?.uid ?? "", store?.tenantId ?? "", id];
  const q = useQuery({ queryKey: key, queryFn: () => ok(api.GET("/v1/tickets/{id}", { params: { path: { id } } })), enabled: Boolean(store), meta: { toast: false } });
  const back = (
    <Link href="/tickets" className="inline-flex items-center gap-1.5 text-body-sm text-text-2 hover:text-text">
      <Icon name="back" size={16} />{t("back")}
    </Link>
  );
  const frame = (body: React.ReactNode) => <div className="mx-auto flex max-w-[1200px] flex-col gap-5 px-4 pt-6 pb-14 md:px-6" data-testid="ticket">{back}{body}</div>;
  if (q.isPending) return frame(<div className="mz-card"><SkeletonRows rows={5} label={t("loading")} /></div>);
  if (!q.data) {
    const missing = q.error instanceof ApiError && q.error.status === 404;
    return frame(<div className="mz-card"><EmptyState icon="error" title={missing ? t("notFound") : problemText(q.error, tpr)} body="" /></div>);
  }
  const tk = q.data;
  const nameOf = (userId: unknown) => tk.assignees.find((a) => a.id === userId)?.name ?? (tk.assignee && tk.assignee.id === userId ? tk.assignee.name : null) ?? t("member");
  const title = (e: Ticket["history"][number]) => {
    const d = e.data as Record<string, unknown>;
    switch (e.type) {
      case "created": return t("history.created");
      case "status": return t("history.status", { from: t(`status.${d.from as "open"}`), to: t(`status.${d.to as "open"}`) });
      case "assigned": return d.to ? t("history.assigned", { name: nameOf(d.to) }) : t("history.unassigned");
      case "updated": return t("history.updated", { fields: Object.keys(d).map((f) => t(`fields.${f as "type"}`)).join("، ") });
      case "note": return t("history.note");
    }
  };
  return frame(
    <>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="font-display text-heading-lg"><IdCell>{tk.number}</IdCell></h1>
        <Badge tone={STATUS_TONE[tk.status]}>{t(`status.${tk.status}`)}</Badge>
        <Tag>{t(`type.${tk.type}`)}</Tag>
        {tk.late ? <Badge tone="danger">{t("late")}</Badge> : null}
      </header>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card title={t("details")}>
            <div className="flex flex-col gap-3">
              <KeyValue items={[
                { label: t("fields.order"), value: tk.order ? <Link href={`/orders/${tk.order.id}`} className="hover:underline"><IdCell>{tk.order.number}</IdCell></Link> : t("noOrder") },
                { label: t("fields.reason"), value: tk.reason ? t(`reason.${tk.reason}`) : t("noReason") },
                { label: t("fields.source"), value: t(`source.${tk.source}`) },
                { label: t("fields.assignedTo"), value: tk.assignee ? <bdi>{tk.assignee.name ?? t("member")}</bdi> : t("unassigned") },
                { label: t("fields.createdBy"), value: <><bdi>{tk.createdBy?.name ?? t("member")}</bdi>{" · "}<DateText value={tk.createdAt} /></> },
                ...(tk.dueAt && !tk.resolvedAt ? [{ label: t("fields.due"), value: <DateText value={tk.dueAt} /> }] : []),
                ...(tk.resolvedAt ? [{ label: t("fields.resolvedAt"), value: <DateText value={tk.resolvedAt} /> }] : []),
              ]} />
              {tk.description ? <p dir="auto" className="whitespace-pre-wrap text-body-sm">{tk.description}</p> : null}
            </div>
          </Card>
          <Card title={t("history.title")}>
            <div className="flex flex-col gap-4">
              <AddNote id={id} />
              <Timeline label={t("history.title")} items={tk.history.map((e) => ({
                id: e.id, title: title(e),
                detail: e.note ? <span dir="auto" className="block whitespace-pre-wrap">{e.note}</span> : e.actor?.name ? <bdi>{e.actor.name}</bdi> : undefined,
                time: <span className="text-caption text-text-3"><DateText value={e.at} />{e.note && e.actor?.name ? <>{" · "}<bdi>{e.actor.name}</bdi></> : null}</span>,
              }))} />
            </div>
          </Card>
        </div>
        <aside className="flex flex-col gap-4">
          {tk.canEdit ? <WorkOn ticket={tk} /> : tk.status === "closed" ? <Alert tone="info">{t("closedHint")}</Alert> : null}
        </aside>
      </div>
    </>,
  );
}

function WorkOn({ ticket }: { ticket: Ticket }) {
  const t = useTranslations("tickets");
  const tpr = useTranslations("problem");
  const { api } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState(ticket.status);
  const [type, setType] = useState(ticket.type);
  const [reason, setReason] = useState<string>(ticket.reason ?? "");
  const [assignee, setAssignee] = useState<string>(ticket.assignee?.id ?? "");
  const body: Patch = {
    ...(status !== ticket.status ? { status } : {}), ...(type !== ticket.type ? { type } : {}),
    ...(reason !== (ticket.reason ?? "") ? { reason: (reason || null) as Patch["reason"] } : {}),
    ...(assignee !== (ticket.assignee?.id ?? "") ? { assignedTo: assignee || null } : {}),
  };
  const changed = Object.keys(body).length > 0;
  const save = useMutation({
    mutationFn: () => ok(api.PATCH("/v1/tickets/{id}", { params: { path: { id: ticket.id } }, body })),
    meta: { toast: false },
    onSuccess: () => { toast({ message: t("saved") }); void qc.invalidateQueries({ queryKey: ["ticket"] }); void qc.invalidateQueries({ queryKey: ["tickets"] }); },
  });
  // Someone else's assignee stays selectable as it is, even when the caller may not pick them.
  const people = ticket.assignee && !ticket.assignees.some((a) => a.id === ticket.assignee!.id) ? [...ticket.assignees, { ...ticket.assignee, role: "" }] : ticket.assignees;
  return (
    <Card title={t("workOn")}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (changed) save.mutate(); }}>
        <Select label={t("fields.status")} value={status} onChange={(e) => setStatus(e.target.value as Ticket["status"])}>
          {TICKET_STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
        </Select>
        <Select label={t("fields.type")} value={type} onChange={(e) => setType(e.target.value as Ticket["type"])}>
          {TICKET_TYPES.map((v) => <option key={v} value={v}>{t(`type.${v}`)}</option>)}
        </Select>
        <Select label={t("fields.reason")} value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="">{t("noReason")}</option>
          {TICKET_REASONS.map((v) => <option key={v} value={v}>{t(`reason.${v}`)}</option>)}
        </Select>
        <Select label={t("fields.assignedTo")} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">{t("unassigned")}</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name ?? t("member")}</option>)}
        </Select>
        {save.isError ? <Alert tone="danger">{save.error instanceof ApiError && save.error.code === "ticket_closed" ? t("closedHint") : problemText(save.error, tpr)}</Alert> : null}
        <Button type="submit" busy={save.isPending} disabled={!changed}>{t("save")}</Button>
      </form>
    </Card>
  );
}

function AddNote({ id }: { id: string }) {
  const t = useTranslations("tickets");
  const tpr = useTranslations("problem");
  const { api } = useSession();
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const add = useMutation({
    mutationFn: () => ok(api.PATCH("/v1/tickets/{id}", { params: { path: { id } }, body: { note: note.trim() } })),
    meta: { toast: false },
    onSuccess: () => { setNote(""); void qc.invalidateQueries({ queryKey: ["ticket"] }); },
  });
  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (note.trim()) add.mutate(); }}>
      <TextArea label={t("noteLabel")} hint={t("noteHint")} maxLength={2000} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      {add.isError ? <Alert tone="danger">{problemText(add.error, tpr)}</Alert> : null}
      <div><Button type="submit" variant="secondary" size="sm" busy={add.isPending} disabled={!note.trim()}>{t("addNote")}</Button></div>
    </form>
  );
}

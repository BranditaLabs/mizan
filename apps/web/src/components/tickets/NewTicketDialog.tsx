"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Select, TextArea } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { ApiError, ok, type Schemas } from "@/lib/api/client";
import { problemText } from "@/lib/api/query";
import { useSession } from "@/lib/session";
import { TICKET_REASONS, TICKET_SOURCES, TICKET_TYPES } from "./ticket-ui";

type Body = Schemas["NewTicket"];
type Ticket = Schemas["Ticket"];

/**
 * Open a ticket (E10-1): its type, reason and where it came from, on an order (given, or typed by
 * its number) and in the team's words. One open case of a kind per order: a second one points to
 * the first.
 */
export function NewTicketDialog({ order, onClose, onCreated }: { order?: { id: string; number: string }; onClose(): void; onCreated(t: Ticket): void }) {
  const t = useTranslations("tickets");
  const tpr = useTranslations("problem");
  const { api } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [type, setType] = useState<Body["type"]>("complaint");
  const [reason, setReason] = useState<string>("");
  const [source, setSource] = useState<NonNullable<Body["source"]>>("team");
  const [orderNumber, setOrderNumber] = useState("");
  const [description, setDescription] = useState("");
  const save = useMutation({
    mutationFn: () => ok(api.POST("/v1/tickets", { body: {
      type, source, ...(reason ? { reason: reason as NonNullable<Body["reason"]> } : {}),
      ...(order ? { orderId: order.id } : orderNumber.trim() ? { orderNumber: orderNumber.trim() } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
    } })),
    meta: { toast: false },
    onSuccess: (ticket) => {
      toast({ message: t("created", { number: ticket.number }) });
      void qc.invalidateQueries({ queryKey: ["tickets"] });
      onCreated(ticket);
    },
  });
  const err = save.error instanceof ApiError ? save.error : null;
  const orderMissing = err?.status === 422 && err.errors?.some((e) => e.path === "orderNumber");
  const message = err?.code === "ticket_open" ? t("alreadyOpen") : orderMissing ? null : save.isError ? problemText(save.error, tpr) : null;
  return (
    <Dialog open onClose={onClose} title={t("new.title")} description={order ? t("new.forOrder", { number: order.number }) : undefined} footer={(
      <>
        <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
        <Button busy={save.isPending} onClick={() => save.mutate()}>{t("new.save")}</Button>
      </>
    )}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Select label={t("fields.type")} value={type} onChange={(e) => setType(e.target.value as Body["type"])}>
          {TICKET_TYPES.map((v) => <option key={v} value={v}>{t(`type.${v}`)}</option>)}
        </Select>
        <Select label={t("fields.reason")} value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="">{t("noReason")}</option>
          {TICKET_REASONS.map((v) => <option key={v} value={v}>{t(`reason.${v}`)}</option>)}
        </Select>
        {order ? null : (
          <Field label={t("fields.order")} hint={t("new.orderHint")} ltr value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)}
            error={orderMissing ? t("new.orderMissing") : undefined} />
        )}
        <Select label={t("fields.source")} value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
          {TICKET_SOURCES.filter((s) => s !== "automation").map((v) => <option key={v} value={v}>{t(`source.${v}`)}</option>)}
        </Select>
        <TextArea label={t("fields.description")} hint={t("new.descriptionHint")} maxLength={2000} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        {message ? <Alert tone="danger">{message}</Alert> : null}
      </form>
    </Dialog>
  );
}

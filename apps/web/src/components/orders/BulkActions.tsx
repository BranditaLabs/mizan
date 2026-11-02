"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button, ButtonGroup } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Select } from "@/components/ui/Field";
import { Link } from "@/i18n/navigation";
import { ok, type Schemas } from "@/lib/api/client";
import { useSession } from "@/lib/session";

type Bulk = Schemas["BulkAction"];
type Request = Schemas["BulkRequest"];
type Kind = Request["action"];
const REASONS = ["customer_cancelled", "duplicate", "out_of_stock", "fraud", "other"] as const;
export const BULK_ROLES = new Set(["owner", "admin", "ops_manager"]);

/**
 * Bulk actions on the orders list (M1, E5-4): assign, tag, confirm or cancel the selected orders.
 * The API applies them in the background; the progress panel follows until every order is done,
 * skipped (with why) or failed. Cancelling also cancels the Shopify order, never refunds.
 */
export function BulkBar({ selected, clear, onStarted }: { selected: ReadonlySet<string>; clear(): void; onStarted(id: string): void }) {
  const t = useTranslations("orders.bulk");
  const { api, user, store } = useSession();
  const [open, setOpen] = useState<Kind | null>(null);
  const [assignee, setAssignee] = useState("");
  const [tags, setTags] = useState("");
  const [reason, setReason] = useState<(typeof REASONS)[number]>("customer_cancelled");
  const team = useQuery({
    queryKey: ["team", user?.uid ?? "", store?.tenantId ?? ""],
    queryFn: () => ok(api.GET("/v1/members")),
    enabled: open === "assign",
  });
  const start = useMutation({
    mutationFn: (body: Request) => ok(api.POST("/v1/orders/bulk", { body })),
    onSuccess: (b) => { setOpen(null); clear(); onStarted(b.id); },
  });
  const orderIds = [...selected];
  const tagList = tags.split(/[,،]/).map((x) => x.trim()).filter(Boolean);
  const tagsValid = tagList.length > 0 && tagList.length <= 5 && tagList.every((x) => /^[\p{L}\p{N}][\p{L}\p{N} _-]{0,39}$/u.test(x));
  const members = (team.data?.members ?? []).filter((m) => m.status === "active" && ["owner", "admin", "ops_manager", "agent"].includes(m.role));

  const footer = (submit: () => void, label: string, disabled = false, danger = false) => (
    <ButtonGroup>
      <Button variant={danger ? "danger" : "primary"} busy={start.isPending} disabled={disabled} onClick={submit}>{label}</Button>
      <Button variant="ghost" onClick={() => setOpen(null)}>{t("close")}</Button>
    </ButtonGroup>
  );

  return (
    <>
      <ButtonGroup>
        <Button size="sm" variant="secondary" onClick={() => setOpen("assign")}>{t("assign")}</Button>
        <Button size="sm" variant="secondary" onClick={() => setOpen("tag")}>{t("tag")}</Button>
        <Button size="sm" variant="secondary" onClick={() => setOpen("confirm")}>{t("confirm")}</Button>
        <Button size="sm" variant="danger" onClick={() => setOpen("cancel")}>{t("cancel")}</Button>
      </ButtonGroup>

      <Dialog open={open === "assign"} onClose={() => setOpen(null)} title={t("assignTitle", { count: orderIds.length })}
        footer={footer(() => start.mutate({ action: "assign", orderIds, userId: assignee === "none" ? null : assignee }), t("assignGo"), !assignee)}>
        <Select label={t("assignTo")} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="" disabled>{t("choose")}</option>
          <option value="none">{t("unassign")}</option>
          {members.map((m) => <option key={m.userId} value={m.userId}>{m.displayName ?? m.email ?? m.phone ?? m.userId}</option>)}
        </Select>
      </Dialog>

      <Dialog open={open === "tag"} onClose={() => setOpen(null)} title={t("tagTitle", { count: orderIds.length })} description={t("tagHint")}
        footer={footer(() => start.mutate({ action: "tag", orderIds, tags: tagList }), t("tagGo"), !tagsValid)}>
        <Field label={t("tags")} placeholder={t("tagsPlaceholder")} value={tags} onChange={(e) => setTags(e.target.value)} error={tags && !tagsValid ? t("tagsInvalid") : null} />
      </Dialog>

      <Dialog open={open === "confirm"} onClose={() => setOpen(null)} title={t("confirmTitle", { count: orderIds.length })} description={t("confirmHint")}
        footer={footer(() => start.mutate({ action: "confirm", orderIds }), t("confirmGo"))} />

      <Dialog open={open === "cancel"} onClose={() => setOpen(null)} title={t("cancelTitle", { count: orderIds.length })} description={t("cancelHint")}
        footer={footer(() => start.mutate({ action: "cancel", orderIds, reason }), t("cancelGo"), false, true)}>
        <Select label={t("reason")} value={reason} onChange={(e) => setReason(e.target.value as (typeof REASONS)[number])}>
          {REASONS.map((r) => <option key={r} value={r}>{t(`reasons.${r}`)}</option>)}
        </Select>
      </Dialog>
    </>
  );
}

/** Follows a bulk action until it is done; then the list refreshes. */
export function BulkProgress({ id, onClose }: { id: string; onClose(): void }) {
  const t = useTranslations("orders.bulk");
  const { api, user, store } = useSession();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["bulk", user?.uid ?? "", store?.tenantId ?? "", id],
    queryFn: async () => {
      const b = await ok(api.GET("/v1/orders/bulk/{bulkId}", { params: { path: { bulkId: id } } }));
      if (b.status === "done") {
        void qc.invalidateQueries({ queryKey: ["orders"] });
        if (b.action === "ship") void qc.invalidateQueries({ queryKey: ["shipments"] });
      }
      return b;
    },
    refetchInterval: (query) => (query.state.data?.status === "done" ? false : 1000),
  });
  const b: Bulk | undefined = q.data;
  if (!b) return null;
  const finished = b.done + b.skipped + b.failed;
  const pct = Math.round((finished / b.total) * 100);
  return (
    <section className="mz-card flex flex-col gap-3 p-4" aria-live="polite" data-testid="bulk-progress">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-label">{t(b.status === "done" ? "finished" : "running", { action: t(`name.${b.action}`) })}</h2>
        {b.status === "done" ? <Button size="sm" variant="ghost" onClick={onClose}>{t("close")}</Button> : null}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-sunk" role="progressbar" aria-valuemin={0} aria-valuemax={b.total} aria-valuenow={finished} aria-label={t("progress")}>
        <div className="h-full rounded-full bg-text transition-[inline-size]" style={{ inlineSize: `${pct}%` }} />
      </div>
      <p className="text-body-sm text-text-2">{t("counts", { done: b.done, skipped: b.skipped, failed: b.failed, total: b.total })}</p>
      {b.issues.length ? (
        <ul className="flex flex-col gap-1 text-body-sm">
          {b.issues.slice(0, 20).map((i) => (
            <li key={i.orderId} className="flex flex-wrap gap-2">
              <Link href={`/orders/${i.orderId}`} className="hover:underline"><bdi>{i.number}</bdi></Link>
              <span className="text-text-2">{t.has(`why.${i.reason}`) ? t(`why.${i.reason}` as "why.error") : i.reason}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {b.status === "done" && b.failed > 0 ? <Alert tone="warning">{t("failedHint")}</Alert> : null}
    </section>
  );
}

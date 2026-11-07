"use client";

import { useMutation } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button, IconButton } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Choice";
import { Dialog } from "@/components/ui/Dialog";
import { TextArea } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { usePathname } from "@/i18n/navigation";
import { ApiError, ok, type Schemas } from "@/lib/api/client";
import { problemText } from "@/lib/api/query";
import { useSession } from "@/lib/session";

type Kind = Schemas["SendFeedback"]["kind"];
const KINDS: readonly Kind[] = ["idea", "problem", "question"];
export const FEEDBACK_MAX = 2000;
const OPEN_EVENT = "mizan:feedback";

/** Opens the feedback dialog from anywhere in the shell (the ⌘K palette). */
export function openFeedback() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/**
 * In-app feedback (L1-8): a header button (and a palette command) opens a dialog — an idea, a
 * problem or a question, a message, and the page the person is on (path only, shown to them). It
 * goes to the Mizan team with the store and the person; the store never reads it back.
 */
export function FeedbackButton() {
  const t = useTranslations("feedback");
  const { store } = useSession();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, show);
    return () => window.removeEventListener(OPEN_EVENT, show);
  }, []);
  if (!store) return null;
  return (
    <>
      {/* At phone width the header has no room: the ⌘K palette (the search button) opens it there. */}
      <span className="hidden md:contents">
        <IconButton icon="message" label={t("open")} onClick={() => setOpen(true)} aria-haspopup="dialog" data-testid="feedback-open" />
      </span>
      {open ? <FeedbackDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function FeedbackDialog({ onClose }: { onClose(): void }) {
  const t = useTranslations("feedback");
  const tp = useTranslations("problems");
  const locale = useLocale();
  const pathname = usePathname();
  const { api } = useSession();
  const toast = useToast();
  const [kind, setKind] = useState<Kind>("idea");
  const [message, setMessage] = useState("");
  const page = `/${locale}${pathname === "/" ? "" : pathname}`;
  const send = useMutation({
    mutationFn: () => ok(api.POST("/v1/feedback", { body: { kind, message: message.trim(), page } })),
    meta: { toast: false },
    onSuccess: () => { toast.event({ type: null, message: t("sent") }); onClose(); },
  });
  const err = send.error;
  const left = FEEDBACK_MAX - message.length;
  const empty = message.trim().length === 0;
  return (
    <Dialog open onClose={onClose} title={t("title")} description={t("description")} className="w-[min(520px,calc(100vw-32px))]"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>{t("cancel")}</Button>
          <Button variant="primary" icon="send" busy={send.isPending} disabled={empty} onClick={() => send.mutate()} data-testid="feedback-send">{t("send")}</Button>
        </>
      )}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (!empty) send.mutate(); }} data-testid="feedback-dialog">
        <div className="flex flex-col gap-1.5">
          <span className="mz-label" aria-hidden="true">{t("kindLabel")}</span>
          <Segmented<Kind> label={t("kindLabel")} value={kind} onChange={setKind} options={KINDS.map((k) => ({ value: k, label: t(`kind.${k}`) }))} />
        </div>
        <TextArea label={t("messageLabel")} value={message} maxLength={FEEDBACK_MAX} rows={5} data-autofocus
          placeholder={t(`placeholder.${kind}`)} onChange={(e) => setMessage(e.target.value)}
          hint={t.rich("left", { n: left, num: (c) => <bdi className="mz-num">{c}</bdi> })} />
        {/* Read out only near the limit, not on every key. */}
        <span className="sr-only" aria-live="polite">{left <= 100 ? t.markup("left", { n: left, num: (c) => c }) : ""}</span>
        <p className="text-caption text-text-2">{t.rich("page", { path: () => <bdi dir="ltr" className="mz-num">{page}</bdi> })}</p>
        {err ? (
          <Alert tone="danger">{err instanceof ApiError && err.status === 429 ? t("tooMany") : problemText(err, tp)}</Alert>
        ) : null}
      </form>
    </Dialog>
  );
}

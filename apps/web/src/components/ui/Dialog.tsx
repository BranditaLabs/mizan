"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button, IconButton } from "./Button";
import { cx } from "./logic";

/**
 * Dialog and drawer on the native modal <dialog> (components.md §7): the browser traps focus, makes
 * the page inert, closes on Esc and returns focus to the opener. A click on the scrim closes too.
 * The parent owns `open`; every way of closing calls `onClose`. Mark the element to focus first with
 * `data-autofocus` (default: the first focusable one).
 */
export function useModal(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      el.showModal();
      // `data-autofocus` (not React's autoFocus, which fires before showModal and confuses the opener).
      el.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    }
    if (!open && el.open) {
      el.close();
      // The content unmounts before close(), so the browser may not restore focus: do it here.
      opener.current?.focus();
      opener.current = null;
    }
  }, [open]);
  return {
    ref,
    onCancel: (e: React.SyntheticEvent) => { e.preventDefault(); onClose(); },
    onClick: (e: React.MouseEvent<HTMLDialogElement>) => { if (e.target === e.currentTarget) onClose(); },
  };
}

export function Dialog({ open, onClose, title, description, children, footer, className }: {
  open: boolean; onClose(): void; title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode; className?: string;
}) {
  const t = useTranslations("ui");
  const id = useId();
  const modal = useModal(open, onClose);
  return (
    <dialog {...modal} aria-labelledby={`${id}-title`} aria-describedby={description ? `${id}-desc` : undefined}
      className={cx("mz-dialog mz-enter m-auto text-text backdrop:bg-scrim", !open && "hidden", className)}>
      {open ? (
        <>
          <div className="flex items-start gap-3">
            <h2 id={`${id}-title`} className="flex-1 text-heading-sm">{title}</h2>
            <IconButton icon="close" label={t("close")} size="sm" onClick={onClose} className="-me-2 -mt-1" />
          </div>
          {description ? <p id={`${id}-desc`} className="text-body-sm text-text-2">{description}</p> : null}
          {children}
          {footer ? <div className="mt-2 flex flex-wrap justify-end gap-2">{footer}</div> : null}
        </>
      ) : null}
    </dialog>
  );
}

/**
 * Confirmation for a destructive action: names the object and the consequence ("Cancel #EO-48213?
 * Bosta will be asked to terminate the delivery."); the confirm button is `danger-solid`, and the
 * safe choice has the focus.
 */
export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel, busy }: {
  open: boolean; onClose(): void; onConfirm(): void; title: ReactNode; description: ReactNode; confirmLabel: string; busy?: boolean;
}) {
  const t = useTranslations("ui");
  return (
    <Dialog open={open} onClose={onClose} title={title} description={description}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} data-autofocus>{t("cancel")}</Button>
          <Button variant="danger-solid" busy={busy} onClick={onConfirm}>{confirmLabel}</Button>
        </>
      )} />
  );
}

/** Drawer at the inline end (440px; full width on phones): side panels such as an order's details. */
export function Drawer({ open, onClose, title, children, footer }: { open: boolean; onClose(): void; title: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const t = useTranslations("ui");
  const id = useId();
  const modal = useModal(open, onClose);
  return (
    <dialog {...modal} aria-labelledby={`${id}-title`}
      className={cx("mz-drawer mz-enter ms-auto me-0 my-0 h-dvh max-h-dvh flex-col text-text backdrop:bg-scrim", open ? "flex" : "hidden")}>
      {open ? (
        <>
          <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-5">
            <h2 id={`${id}-title`} className="flex-1 text-heading-sm">{title}</h2>
            <IconButton icon="close" label={t("close")} size="sm" onClick={onClose} />
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
          {footer ? <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer> : null}
        </>
      ) : null}
    </dialog>
  );
}

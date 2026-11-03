"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "./Button";
import { ConfirmDialog } from "./Dialog";

/**
 * One way to save settings (U5): nothing to press until something changed; then a bar stays at
 * the bottom of the page with Discard and Save, above the phone bar on small screens. While there
 * are changes, leaving asks first: a link inside the app opens "Leave without saving?", closing or
 * reloading the tab gets the browser's own warning.
 */
export function SaveBar({ dirty, busy = false, canSave = true, onSave, onDiscard }: {
  dirty: boolean; busy?: boolean; canSave?: boolean; onSave(): void; onDiscard(): void;
}) {
  const t = useTranslations("ui.saveBar");
  const router = useRouter();
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  useLeaveGuard(dirty, setLeaveTo);
  return (
    <>
      {dirty ? (
        <div role="region" aria-label={t("label")} data-testid="save-bar"
          className="g sticky bottom-[calc(88px+env(safe-area-inset-bottom,0px))] z-20 flex flex-wrap items-center gap-3 px-4 py-3 lg:bottom-4">
          <p className="min-w-0 flex-1 text-body-sm">{t("unsaved")}</p>
          <Button variant="ghost" disabled={busy} onClick={onDiscard}>{t("discard")}</Button>
          <Button busy={busy} disabled={!canSave} onClick={onSave}>{t("save")}</Button>
        </div>
      ) : null}
      <ConfirmDialog open={leaveTo !== null} onClose={() => setLeaveTo(null)} title={t("leaveTitle")} description={t("leaveBody")} confirmLabel={t("leave")}
        onConfirm={() => { const to = leaveTo; setLeaveTo(null); onDiscard(); if (to) router.push(to); }} />
    </>
  );
}

/** While `dirty`: catch in-app link clicks (asking through `ask`) and warn before the tab closes. */
function useLeaveGuard(dirty: boolean, ask: (href: string) => void) {
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    const click = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      e.preventDefault();
      e.stopPropagation();
      ask(`${url.pathname}${url.search}${url.hash}`);
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", click, true);
    return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", click, true); };
  }, [dirty, ask]);
}

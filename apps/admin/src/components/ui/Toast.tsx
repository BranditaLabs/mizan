"use client";

import { MOTION } from "@mizan/design-system/motion";
import { EventGlyph } from "@mizan/design-system/react/motion";
import { Icon } from "@mizan/design-system/icons/react";
import type { Outcome } from "@mizan/shared/motion";
import { useTranslations } from "next-intl";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

/**
 * Toasts (components.md §6, `.mz-toast`): ink, bottom-end, 4 s, one line in the past tense
 * ("24 orders shipped with Bosta"), optional Undo. Announced politely; never for errors that need a
 * decision (use an alert or a dialog).
 * Brand 2.0: a toast enters with SETTLE and leaves with the exit token; `outcome` (a failed action:
 * "fail") leads with its glyph from the design system. Reduced motion crossfades.
 */
export interface ToastInput { message: ReactNode; action?: { label: string; onClick(): void }; outcome?: Outcome }
interface ToastItem extends ToastInput { id: number; leaving?: boolean }
let nextId = 1;

const Ctx = createContext<((t: ToastInput) => void) | null>(null);
export const TOAST_MS = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useTranslations("motion");
  const [items, setItems] = useState<ToastItem[]>([]);
  const remove = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const dismiss = useCallback((id: number) => {
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
    setTimeout(() => remove(id), MOTION.duration.exit);
  }, [remove]);
  const push = useCallback((input: ToastInput) => {
    const id = nextId++;
    setItems((xs) => [...xs.slice(-2), { ...input, id }]); // at most three on screen
    setTimeout(() => dismiss(id), TOAST_MS);
  }, [dismiss]);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div role="status" aria-live="polite" className="pointer-events-none fixed bottom-4 end-4 z-[var(--mz-z-toast)] flex w-[min(380px,calc(100vw-32px))] flex-col gap-2">
        {items.map((it) => (
          <div key={it.id} className={`mz-toast pointer-events-auto ${it.leaving ? "mz-exit" : "mz-settle-in"}`} data-outcome={it.outcome}>
            {it.outcome && it.outcome !== "quiet" ? <EventGlyph outcome={it.outcome} size={18} /> : null}
            <span className="flex-1">{it.message}</span>
            {it.action ? (
              <button type="button" className="text-label underline underline-offset-2" onClick={() => { it.action!.onClick(); dismiss(it.id); }}>{it.action.label}</button>
            ) : null}
            <button type="button" aria-label={t("toast.dismiss")} className="opacity-70 hover:opacity-100" onClick={() => dismiss(it.id)}>
              <Icon name="close" size={14} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): (t: ToastInput) => void {
  const push = useContext(Ctx);
  if (!push) throw new Error("useToast outside ToastProvider");
  return push;
}

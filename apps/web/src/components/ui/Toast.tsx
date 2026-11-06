"use client";

import { Icon } from "@mizan/design-system/icons/react";
import { useTranslations } from "next-intl";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

/**
 * Toasts (components.md §6, `.mz-toast`): ink, bottom-end on desktop; below 1024px centred above
 * the phone's bottom navigation and the safe area (docs/16 §2.4), 4 s, one line in the past tense
 * ("24 orders shipped with Bosta"), optional Undo. Announced politely; never for errors that need a
 * decision (use an alert or a dialog).
 */
export interface ToastInput { message: ReactNode; action?: { label: string; onClick(): void } }
interface ToastItem extends ToastInput { id: number }

const Ctx = createContext<((t: ToastInput) => void) | null>(null);
export const TOAST_MS = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useTranslations("ui");
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const push = useCallback((input: ToastInput) => {
    const id = next.current++;
    setItems((xs) => [...xs.slice(-2), { ...input, id }]); // at most three on screen
    setTimeout(() => dismiss(id), TOAST_MS);
  }, [dismiss]);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div role="status" aria-live="polite" className="print:hidden pointer-events-none fixed inset-x-0 bottom-[calc(88px+env(safe-area-inset-bottom))] z-[var(--mz-z-toast)] mx-auto flex w-[min(380px,calc(100vw-32px))] flex-col gap-2 lg:inset-x-auto lg:end-4 lg:bottom-4 lg:mx-0">
        {items.map((it) => (
          <div key={it.id} className="mz-toast pointer-events-auto">
            <span className="flex-1">{it.message}</span>
            {it.action ? (
              <button type="button" className="min-h-6 text-label underline underline-offset-2 pointer-coarse:min-h-11" onClick={() => { it.action!.onClick(); dismiss(it.id); }}>{it.action.label}</button>
            ) : null}
            <button type="button" aria-label={t("dismiss")} className="inline-flex size-6 shrink-0 items-center justify-center opacity-70 hover:opacity-100 pointer-coarse:size-11" onClick={() => dismiss(it.id)}>
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

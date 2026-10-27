"use client";

import { Icon } from "@mizan/design-system/icons/react";
import { useTranslations } from "next-intl";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

/**
 * Toasts (components.md §6, `.mz-toast`): ink, bottom-end, 4 s, one line in the past tense
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
      <div role="status" aria-live="polite" className="pointer-events-none fixed bottom-4 end-4 z-[var(--mz-z-toast)] flex w-[min(380px,calc(100vw-32px))] flex-col gap-2">
        {items.map((it) => (
          <div key={it.id} className="mz-toast mz-enter pointer-events-auto">
            <span className="flex-1">{it.message}</span>
            {it.action ? (
              <button type="button" className="text-label underline underline-offset-2" onClick={() => { it.action!.onClick(); dismiss(it.id); }}>{it.action.label}</button>
            ) : null}
            <button type="button" aria-label={t("dismiss")} className="opacity-70 hover:opacity-100" onClick={() => dismiss(it.id)}>
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

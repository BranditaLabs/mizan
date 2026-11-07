"use client";

import { MOTION } from "@mizan/design-system/motion";
import { EventGlyph } from "@mizan/design-system/react/motion";
import { Icon } from "@mizan/design-system/icons/react";
import type { EventData, Outcome } from "@mizan/shared/motion";
import { useTranslations } from "next-intl";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { eventMotion } from "@/lib/motion/resolve";

/**
 * Toasts (components.md §6, `.mz-toast`): ink, bottom-end on desktop; below 1024px centred above
 * the phone's bottom navigation and the safe area (docs/16 §2.4), 4 s, one line in the past tense
 * ("24 orders shipped with Bosta"), optional Undo. Announced politely; never for errors that need a
 * decision (use an alert or a dialog).
 *
 * Motion comes from the event-motion catalogue, never from the screen: `toast.event({ type })`
 * leads with the outcome's glyph (done draws its check, merge forms the neck, a confirmed order or
 * money in DROPs the red) and says `motion.event.<type>` unless the screen passes its own message.
 * Every toast enters with SETTLE and leaves with the exit token; reduced motion crossfades.
 * `toast()` stays for text with no event (a link copied); it can only add the fail glyph (an error),
 * never pick another outcome. `toast.event` goes through the motion provider when one is mounted
 * (EventMotionProvider routes it): the echo record, the DROP gap and the event's other surfaces.
 */
export interface ToastInput { message: ReactNode; action?: { label: string; onClick(): void }; outcome?: "fail" }
interface ShownToast { message: ReactNode; action?: ToastInput["action"]; outcome?: Outcome }
export interface ToastEventInput {
  /**
   * A domain event type from the catalogue (`order.confirmed`), or null for a save that is no
   * catalogue event (a setting): it settles (SETTLE), with the screen's message.
   */
  type: string | null;
  /** The non-PII facts its variant reads (`{ data: { to: "paid" } }`). */
  data?: EventData;
  /** ICU values for the catalogue copy. */
  values?: Record<string, string | number>;
  /** The screen's own sentence instead of the catalogue copy ("24 orders shipped with Bosta"). */
  message?: ReactNode;
  action?: ToastInput["action"];
  /** The entity it touched: the same event from a poll within 8 s plays nothing (echo). */
  entityId?: string;
}
/** How the motion provider receives `toast.event` (it calls `show` back with its decision). */
export type ToastRouter = (e: ToastEventInput & { type: string }) => void;
export type Toaster = ((t: ToastInput) => void) & {
  event(e: ToastEventInput): void;
  /** The engine's side: show an event toast now (outcome "done" when the DROP gap refused a DROP). */
  show(e: ToastEventInput & { outcome?: "done" }): void;
  /** EventMotionProvider registers itself here; null: toast.event shows directly. */
  route(r: ToastRouter | null): void;
};
interface ToastItem extends ShownToast { id: number; leaving?: boolean }

const Ctx = createContext<Toaster | null>(null);
function routerHub() {
  let current: ToastRouter | null = null;
  return { get: () => current, set: (r: ToastRouter | null) => { current = r; } };
}
export const TOAST_MS = 4000;
let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useTranslations("motion");
  const tAll = useTranslations();
  const [items, setItems] = useState<ToastItem[]>([]);
  const remove = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  // Leaving plays the exit (150 ms, 80 ms reduced) before the toast is removed.
  const dismiss = useCallback((id: number) => {
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
    setTimeout(() => remove(id), MOTION.duration.exit);
  }, [remove]);
  const push = useCallback((input: ShownToast) => {
    const id = nextId++;
    setItems((xs) => [...xs.slice(-2), { ...input, id }]); // at most three on screen
    setTimeout(() => dismiss(id), TOAST_MS);
  }, [dismiss]);
  // Who receives toast.event (read only when a toast fires, never during render).
  const [hub] = useState(routerHub);
  const toaster = useMemo<Toaster>(() => {
    const show = ({ type, data, values, message, action, outcome }: ToastEventInput & { outcome?: "done" }) => {
      const m = type ? eventMotion(type, data) : { outcome: "settle" as const, copy: null, values: {} };
      const copy = message ?? (m.copy && tAll.has(m.copy) ? tAll(m.copy, { ...m.values, ...values }) : null);
      if (copy === null) return;
      push({ message: copy, outcome: outcome ?? m.outcome, ...(action ? { action } : {}) });
    };
    return Object.assign((input: ToastInput) => push(input), {
      event: (e: ToastEventInput) => { const r = hub.get(); if (r && e.type) r({ ...e, type: e.type }); else show(e); },
      show,
      route: (r: ToastRouter | null) => hub.set(r),
    });
  }, [push, tAll, hub]);
  return (
    <Ctx.Provider value={toaster}>
      {children}
      <div role="status" aria-live="polite" className="print:hidden pointer-events-none fixed inset-x-0 bottom-[calc(88px+env(safe-area-inset-bottom))] z-[var(--mz-z-toast)] mx-auto flex w-[min(380px,calc(100vw-32px))] flex-col gap-2 lg:inset-x-auto lg:end-4 lg:bottom-4 lg:mx-0">
        {items.map((it) => (
          <div key={it.id} className={`mz-toast pointer-events-auto ${it.leaving ? "mz-exit" : "mz-settle-in"}`} data-outcome={it.outcome}>
            {it.outcome && it.outcome !== "quiet" ? <EventGlyph outcome={it.outcome} size={18} /> : null}
            <span className="flex-1">{it.message}</span>
            {it.action ? (
              <button type="button" className="min-h-6 text-label underline underline-offset-2 pointer-coarse:min-h-11" onClick={() => { it.action!.onClick(); dismiss(it.id); }}>{it.action.label}</button>
            ) : null}
            <button type="button" aria-label={t("toast.dismiss")} className="inline-flex size-6 shrink-0 items-center justify-center opacity-70 hover:opacity-100 pointer-coarse:size-11" onClick={() => dismiss(it.id)}>
              <Icon name="close" size={14} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): Toaster {
  const push = useContext(Ctx);
  if (!push) throw new Error("useToast outside ToastProvider");
  return push;
}

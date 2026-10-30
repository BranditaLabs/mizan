"use client";

import { cloneElement, isValidElement, useId, useRef, useState, type ReactElement, type ReactNode } from "react";

/**
 * Tooltip (`.mz-tooltip`, ink, 12px) above its trigger, on hover after a short delay and at once on
 * keyboard focus; Esc hides it. For extra detail only: never the only place for needed information.
 */
export function Tooltip({ content, children }: { content: ReactNode; children: ReactElement<{ "aria-describedby"?: string }> }) {
  const id = useId();
  const [shown, setShown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = (delay: number) => { clearTimeout(timer.current); timer.current = setTimeout(() => setShown(true), delay); };
  const hide = () => { clearTimeout(timer.current); setShown(false); };
  return (
    <span className="relative inline-flex"
      onPointerEnter={() => show(300)} onPointerLeave={hide} onFocus={() => show(0)} onBlur={hide}
      onKeyDown={(e) => { if (e.key === "Escape") hide(); }}>
      {isValidElement(children) ? cloneElement(children, { "aria-describedby": shown ? id : undefined }) : children}
      {shown ? (
        <span className="pointer-events-none absolute inset-x-0 bottom-full z-[var(--mz-z-tooltip)] mb-1.5 flex justify-center">
          <span id={id} role="tooltip" className="mz-tooltip w-max max-w-[260px] whitespace-normal">{content}</span>
        </span>
      ) : null}
    </span>
  );
}

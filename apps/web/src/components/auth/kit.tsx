"use client";

import { useId, useState, type ReactNode } from "react";

/**
 * The older building blocks still used by two-step and welcome (AU-2/AU-3 move them onto the
 * shared auth kit, packages/design-system react/auth.tsx): the step's title, a step, and the code
 * as six glass boxes over one real input. Sign-in uses the shared kit already.
 */

/** The step's title (the page's h1) and one line under it; a `brief` line is a greeting, dropped on short windows so the step fits without scrolling. */
export function AuthHeading({ title, body, level = 1, brief = false }: { title: ReactNode; body?: ReactNode; level?: 1 | 2; brief?: boolean }) {
  const H = level === 1 ? "h1" : "h2";
  return (
    <div className="flex flex-col gap-2.5">
      <H className="disp auth-title m-0 text-balance">{title}</H>
      {body ? <p className={`muted m-0 text-body-lg text-pretty ${brief ? "[@media(max-height:760px)]:hidden" : ""}`}>{body}</p> : null}
    </div>
  );
}

/** One step of a flow. Give it a `key` per step: a new step slides in from the reading direction. */
export function Step({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mz-step flex flex-col gap-(--_gap) ${className}`}>{children}</div>;
}

/**
 * A one-time code as six glass boxes over one real input: typing, pasting a whole code and the
 * phone's autofill (one-time-code) all work, and screen readers see one field with its label.
 */
export function CodeField({ label, hint, value, onChange, length = 6, name = "code" }: {
  label: string; hint?: ReactNode; value: string; onChange(v: string): void; length?: number; name?: string;
}) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const digits = value.replace(/\D/g, "").slice(0, length);
  return (
    <div className="field">
      <label htmlFor={id} className="label text-label">{label}</label>
      <div className="relative grid gap-2.5" dir="ltr" style={{ gridTemplateColumns: `repeat(${length}, minmax(0, 1fr))` }}>
        {Array.from({ length }, (_, i) => {
          const on = focused && i === Math.min(digits.length, length - 1);
          return <span key={i} aria-hidden="true" className={`auth-box tabular-nums ${digits[i] ? "filled mz-digit" : ""} ${on ? "on" : ""}`}>{digits[i] ?? ""}</span>;
        })}
        <input id={id} name={name} value={digits} inputMode="numeric" autoComplete="one-time-code" required autoFocus maxLength={length}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, length))}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          className="absolute inset-0 h-full w-full cursor-text bg-transparent text-transparent caret-transparent opacity-0" />
      </div>
      {hint ? <div id={`${id}-hint`} className="hint">{hint}</div> : null}
    </div>
  );
}


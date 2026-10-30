"use client";

import { Icon } from "@mizan/design-system/icons/react";
import { useTranslations } from "next-intl";
import { useId, useState, type InputHTMLAttributes, type ReactNode } from "react";

/**
 * Building blocks shared by every screen outside a store (sign-in, two-step, welcome): one heading
 * style, a step that slides in from the reading direction, a code field drawn as six boxes, a
 * password field with show/hide and a Caps Lock note, and the moment of success.
 */

/** The step's title and one line under it. */
export function AuthHeading({ title, body, level = 1 }: { title: ReactNode; body?: ReactNode; level?: 1 | 2 }) {
  const H = level === 1 ? "h1" : "h2";
  return (
    <div className="flex flex-col gap-2">
      <H className="font-display text-heading-lg text-balance">{title}</H>
      {body ? <p className="text-body text-text-2 text-pretty">{body}</p> : null}
    </div>
  );
}

/** One step of a flow. Give it a `key` per step: a new step slides in from the reading direction. */
export function Step({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mz-step flex flex-col gap-5 ${className}`}>{children}</div>;
}

/**
 * A one-time code, drawn as six boxes over one real input: typing, pasting a whole code and the
 * phone's autofill (one-time-code) all work, and screen readers see one field with its label.
 */
export function CodeField({ label, hint, value, onChange, length = 6, name = "code" }: {
  label: string; hint?: ReactNode; value: string; onChange(v: string): void; length?: number; name?: string;
}) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const digits = value.replace(/\D/g, "").slice(0, length);
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-label text-text">{label}</label>
      <div className="relative" dir="ltr">
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${length}, minmax(0, 1fr))` }} aria-hidden="true">
          {Array.from({ length }, (_, i) => {
            const current = focused && (i === digits.length || (digits.length === length && i === length - 1));
            return (
              <span key={i} className={`flex h-12 items-center justify-center rounded-md border bg-surface font-display text-heading-md tabular-nums transition-[border-color,box-shadow,transform] duration-150 ${current ? "border-focus ring-4 ring-focus/15" : digits[i] ? "border-line-strong" : "border-line"} ${digits[i] ? "mz-digit" : ""}`}>
                {digits[i] ?? ""}
              </span>
            );
          })}
        </div>
        <input id={id} name={name} value={digits} inputMode="numeric" autoComplete="one-time-code" required autoFocus maxLength={length}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, length))}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          className="absolute inset-0 h-full w-full cursor-text bg-transparent text-transparent caret-transparent opacity-0" />
      </div>
      {hint ? <p id={`${id}-hint`} className="text-caption text-text-3">{hint}</p> : null}
    </div>
  );
}

/** A password with show/hide (the button names its action, not the field) and a Caps Lock note. */
export function PasswordField({ label, hint, ...input }: { label: string; hint?: ReactNode } & Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const t = useTranslations("auth");
  const id = useId();
  const [shown, setShown] = useState(false);
  const [caps, setCaps] = useState(false);
  const described = [hint ? `${id}-hint` : null, caps ? `${id}-caps` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-label text-text">{label}</label>
      <div className="relative" dir="ltr">
        <input id={id} {...input} type={shown ? "text" : "password"} aria-describedby={described}
          onKeyUp={(e) => setCaps(e.getModifierState("CapsLock"))} onKeyDown={(e) => setCaps(e.getModifierState("CapsLock"))}
          className="mz-input h-11 pe-11" />
        <button type="button" onClick={() => setShown((s) => !s)} aria-pressed={shown} aria-controls={id} aria-label={shown ? t("hideChars") : t("showChars")}
          className="absolute inset-y-0 end-0 flex w-11 items-center justify-center text-text-3 transition-colors hover:text-text">
          <Icon name={shown ? "hidden" : "visible"} size={16} />
        </button>
      </div>
      {caps ? <p id={`${id}-caps`} className="text-caption text-warning-text">{t("capsLock")}</p> : null}
      {hint ? <p id={`${id}-hint`} className="text-caption text-text-3">{hint}</p> : null}
    </div>
  );
}

/** Signed in: a check draws itself while the store opens. */
export function Done({ text }: { text: string }) {
  return (
    <div className="mz-step flex flex-col items-center gap-4 py-10 text-center" role="status">
      <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
        <circle cx="28" cy="28" r="26" fill="none" className="mz-draw stroke-text" strokeWidth="2" pathLength={1} />
        <path d="M18 29 l7 7 l13 -15" fill="none" className="mz-draw mz-draw--late stroke-brand" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" pathLength={1} />
      </svg>
      <p className="text-body text-text-2">{text}</p>
    </div>
  );
}

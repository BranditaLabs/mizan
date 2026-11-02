"use client";

import { Icon, type IconProps } from "@mizan/design-system/icons/react";
import { useTranslations } from "next-intl";
import { useId, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { ScaleLoader } from "@/components/ui/Loader";

/**
 * Building blocks of the screens before a store, drawn as the "Sign in · glass" board of the Mizan
 * Glass canvas (glass.css: .field, .label, .input, .btn; glass-bridge.css: .auth-*): the step's
 * title, steps that slide in from the reading direction, glass fields (a label row that can carry a
 * link at its end), the code as six boxes over one real input, a back link, and the moment of
 * success on the scale.
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

/** "← Back" at the top of a step. The arrow follows the reading direction. */
export function BackLink({ onClick }: { onClick(): void }) {
  const t = useTranslations("auth");
  return (
    <button type="button" onClick={onClick} className="btn btn-ghost btn-sm self-start px-0">
      <Icon name="back" size={16} />
      {t("back")}
    </button>
  );
}

/** A glass tile with one icon, above a step's title (the code step's message). */
export function StepIcon({ name }: { name: IconProps["name"] }) {
  return <span className="icon-tile size-12 text-success" aria-hidden="true"><Icon name={name} size={20} /></span>;
}

type FieldProps = { label: string; hint?: ReactNode; error?: ReactNode; aside?: ReactNode; lead?: ReactNode } & InputHTMLAttributes<HTMLInputElement>;

/** A glass field: label above (a link may sit at the row's end), the input 48px tall, a hint or error under it. */
export function GlassField({ label, hint, error, aside, lead, className = "", ...input }: FieldProps) {
  const id = useId();
  const note = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div className="field">
      <span className="label flex items-baseline justify-between gap-3 text-label">
        <label htmlFor={id}>{label}</label>
        {aside}
      </span>
      <div className="flex gap-2">
        {lead}
        <input id={id} aria-describedby={note} aria-invalid={error ? true : undefined} {...input} className={`input h-(--_ctl) min-w-0 flex-1 text-body-lg ${className}`} />
      </div>
      {error ? <p id={note} className="err m-0">{error}</p> : hint ? <p id={note} className="hint m-0">{hint}</p> : null}
    </div>
  );
}

/** A password with show/hide (the button names its action, not the field) and a Caps Lock note. */
export function PasswordField({ label, hint, aside, ...input }: { label: string; hint?: ReactNode; aside?: ReactNode } & Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const t = useTranslations("auth");
  const id = useId();
  const [shown, setShown] = useState(false);
  const [caps, setCaps] = useState(false);
  const described = [hint ? `${id}-hint` : null, caps ? `${id}-caps` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="field">
      <span className="label flex items-baseline justify-between gap-3 text-label">
        <label htmlFor={id}>{label}</label>
        {aside}
      </span>
      <div className="relative">
        <input id={id} {...input} type={shown ? "text" : "password"} aria-describedby={described} dir="ltr"
          onKeyUp={(e) => setCaps(e.getModifierState("CapsLock"))} onKeyDown={(e) => setCaps(e.getModifierState("CapsLock"))}
          className="input h-(--_ctl) w-full pe-12 text-body-lg" />
        <button type="button" onClick={() => setShown((s) => !s)} aria-pressed={shown} aria-controls={id} aria-label={shown ? t("hideChars") : t("showChars")}
          className="absolute inset-y-0 end-0 flex w-12 items-center justify-center text-text-3 transition-colors hover:text-text">
          <Icon name={shown ? "hidden" : "visible"} size={16} />
        </button>
      </div>
      {caps ? <p id={`${id}-caps`} className="hint m-0 text-warning-text">{t("capsLock")}</p> : null}
      {hint ? <p id={`${id}-hint`} className="hint m-0">{hint}</p> : null}
    </div>
  );
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

/** Signed in: the scale weighs while the store opens. */
export function Done({ title, text }: { title: string; text: string }) {
  return (
    <div className="mz-step flex flex-col items-center gap-4 py-6 text-center" role="status">
      <ScaleLoader />
      <h1 className="disp m-0 text-heading-lg">{title}</h1>
      <p className="muted m-0 text-body">{text}</p>
      <div className="ld-rail w-48" aria-hidden="true" />
    </div>
  );
}

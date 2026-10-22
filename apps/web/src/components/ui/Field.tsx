import { Icon } from "@mizan/design-system/icons/react";
import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cx } from "./logic";

/**
 * Fields (components.md §3): label above, hint below; the error replaces the hint, with an icon,
 * and marks the control invalid. `ltr` for phones, emails, codes and amounts (typed and shown left
 * to right in Arabic too, tabular digits).
 */
type Common = { label: string; hint?: ReactNode; error?: string | null; className?: string };

function useFieldIds(hint: ReactNode, error: string | null | undefined) {
  const id = useId();
  const note = `${id}-note`;
  return { id, note, describedBy: error || hint ? note : undefined };
}

function Note({ id, hint, error }: { id: string; hint?: ReactNode; error?: string | null }) {
  if (error) {
    return (
      <p id={id} role="alert" className="mz-error-text">
        <Icon name="error" size={14} />
        {error}
      </p>
    );
  }
  return hint ? <p id={id} className="mz-hint">{hint}</p> : null;
}

export function Field({ label, hint, error, ltr = false, className, ...input }: InputHTMLAttributes<HTMLInputElement> & Common & { ltr?: boolean }) {
  const { id, note, describedBy } = useFieldIds(hint, error);
  return (
    <div className={cx("mz-field", className)}>
      <label htmlFor={id} className="mz-label">{label}</label>
      <input id={id} dir={ltr ? "ltr" : undefined} aria-invalid={error ? true : undefined} aria-describedby={describedBy}
        className={cx("mz-input", ltr && "mz-num text-start")} {...input} />
      <Note id={note} hint={hint} error={error} />
    </div>
  );
}

export function TextArea({ label, hint, error, className, ...input }: TextareaHTMLAttributes<HTMLTextAreaElement> & Common) {
  const { id, note, describedBy } = useFieldIds(hint, error);
  return (
    <div className={cx("mz-field", className)}>
      <label htmlFor={id} className="mz-label">{label}</label>
      <textarea id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy} className="mz-textarea" {...input} />
      <Note id={note} hint={hint} error={error} />
    </div>
  );
}

/** Native select (keyboard, screen readers and mobile pickers for free). */
export function Select({ label, hint, error, className, children, ...select }: SelectHTMLAttributes<HTMLSelectElement> & Common) {
  const { id, note, describedBy } = useFieldIds(hint, error);
  return (
    <div className={cx("mz-field", className)}>
      <label htmlFor={id} className="mz-label">{label}</label>
      <select id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy} className="mz-select" {...select}>{children}</select>
      <Note id={note} hint={hint} error={error} />
    </div>
  );
}

/** Search box with the search icon and an optional shortcut hint (⌘K). The label is for screen readers. */
export function SearchInput({ label, shortcut, className, ...input }: InputHTMLAttributes<HTMLInputElement> & { label: string; shortcut?: string }) {
  return (
    <div className={cx("mz-input-wrap", className)}>
      <Icon name="search" size={16} className="mz-icon" />
      <input type="search" aria-label={label} className="mz-input w-full" {...input} />
      {shortcut ? <kbd className="mz-kbd" dir="ltr">{shortcut}</kbd> : null}
    </div>
  );
}

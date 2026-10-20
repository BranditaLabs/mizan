import { useId, type InputHTMLAttributes, type ReactNode } from "react";

/**
 * Field (components.md §3): label above, hint below, the error replaces the hint and is announced.
 * `ltr` for phones, emails, codes and amounts: typed and shown left to right in Arabic too.
 */
export function Field({ label, hint, error, ltr = false, className = "", ...input }:
  InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode; error?: string | null; ltr?: boolean }) {
  const id = useId();
  const note = `${id}-note`;
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-label text-text">{label}</label>
      <input id={id} dir={ltr ? "ltr" : undefined} aria-invalid={error ? true : undefined} aria-describedby={error || hint ? note : undefined}
        className={`h-9 rounded-sm border border-line-strong bg-surface px-3 text-body text-text placeholder:text-text-3 hover:border-text-3 focus-visible:border-focus focus-visible:ring-1 focus-visible:ring-focus ${ltr ? "mz-num text-start" : ""}`}
        {...input} />
      {error ? <p id={note} role="alert" className="text-caption text-danger-text">{error}</p>
        : hint ? <p id={note} className="text-caption text-text-3">{hint}</p> : null}
    </div>
  );
}

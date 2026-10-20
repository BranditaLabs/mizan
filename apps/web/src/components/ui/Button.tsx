import type { ButtonHTMLAttributes } from "react";

/** Buttons (packages/design-system/docs/components.md §2). One primary (ink) action per screen. */
const VARIANTS = {
  primary: "bg-primary text-on-primary hover:bg-primary-hover",
  secondary: "border border-line-strong bg-surface text-text hover:bg-surface-hover",
  ghost: "text-text-2 hover:bg-surface-hover hover:text-text",
} as const;

export function Button({ variant = "primary", busy = false, className = "", children, disabled, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof VARIANTS; busy?: boolean }) {
  return (
    <button type="button" aria-busy={busy || undefined} disabled={disabled || busy}
      className={`inline-flex h-9 items-center justify-center gap-2 rounded-sm px-3.5 text-label transition-colors duration-150 ease-standard active:scale-[.99] disabled:cursor-not-allowed disabled:opacity-60 ${VARIANTS[variant]} ${className}`}
      {...rest}>
      {busy ? <span aria-hidden="true" className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : null}
      {children}
    </button>
  );
}

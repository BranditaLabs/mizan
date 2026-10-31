import { Icon, type IconProps } from "@mizan/design-system/icons/react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./logic";
import { LedgerBars } from "./Loader";

/**
 * Buttons (components.md §2, `.mz-btn`). One `primary` (ink) action per screen; `brand` (red) at
 * most once, for commercial moments; `danger-solid` only to confirm inside a destructive dialog.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "brand" | "danger" | "danger-solid";
export type ButtonSize = "sm" | "md" | "lg";
type IconName = IconProps["name"];

/** The classes of a button, for links that look like one (`<Link className={buttonClass(…)}>`). */
export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", extra?: string): string {
  return cx("mz-btn", `mz-btn--${variant}`, size !== "md" && `mz-btn--${size}`, extra);
}

function Spinner() {
  return <LedgerBars />;
}

export function Button({ variant = "primary", size = "md", busy = false, icon, iconEnd, className, children, disabled, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; busy?: boolean; icon?: IconName; iconEnd?: IconName }) {
  // Busy keeps the width: the label stays (invisible) and the spinner sits on top.
  return (
    <button type="button" aria-busy={busy || undefined} disabled={disabled || busy} className={buttonClass(variant, size, cx("relative", className))} {...rest}>
      <span className={cx("inline-flex items-center gap-2", busy && "invisible")}>
        {icon ? <Icon name={icon} size={16} /> : null}
        {children}
        {iconEnd ? <Icon name={iconEnd} size={16} /> : null}
      </span>
      {busy ? <span className="absolute inset-0 grid place-items-center"><Spinner /></span> : null}
    </button>
  );
}

/** Icon-only button: the label is required (aria-label and tooltip text). */
export function IconButton({ icon, label, variant = "ghost", size = "md", className, ...rest }:
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & { icon: IconName; label: string; variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button type="button" aria-label={label} title={label} className={buttonClass(variant, size, cx("mz-btn--icon", className))} {...rest}>
      <Icon name={icon} size={16} />
    </button>
  );
}

/** Buttons side by side, 8px apart. */
export function ButtonGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("mz-btn-group flex-wrap", className)}>{children}</div>;
}

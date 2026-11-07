import { Icon, type IconProps } from "@mizan/design-system/icons/react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { WaitMeaning } from "@mizan/shared/motion";
import { cx } from "./logic";
import { BusyLabel, BusyLoader, busyKind } from "./BusyLabel";

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

/**
 * What a busy control is doing, never an animation: `busy` absent or false, or `busy` with `as`
 * (loading, signingIn, checking, syncing, sending, saving, creating). A bare `busy` is a type error
 * (and mizan/busy-needs-meaning), so nothing falls back to the save animation. Rows in a list key
 * busy by `mutation.variables` so only the pressed row animates.
 */
export type BusyProps = { busy?: false | null; as?: WaitMeaning } | { busy: boolean; as: WaitMeaning };

/**
 * `busy` keeps the width: the label stays (invisible) and a 16 px mono Brand 2.0 loader sits on top,
 * the one for what the press does (read = pair, send or sync = transfer, a write = drop). Never red.
 * When the work ends, the label settles back in (SETTLE).
 */
export function Button({ variant = "primary", size = "md", busy, as, icon, iconEnd, className, children, disabled, ...rest }:
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "as"> & { variant?: ButtonVariant; size?: ButtonSize; icon?: IconName; iconEnd?: IconName } & BusyProps) {
  busy = Boolean(busy);
  return (
    <button type="button" aria-busy={busy || undefined} disabled={disabled || busy} className={buttonClass(variant, size, cx("relative", className))} {...rest}>
      <BusyLabel busy={busy}>
        {icon ? <Icon name={icon} size={16} /> : null}
        {children}
        {iconEnd ? <Icon name={iconEnd} size={16} /> : null}
      </BusyLabel>
      {busy && as ? <span className="absolute inset-0 grid place-items-center"><BusyLoader pending={busyKind(as)} /></span> : null}
    </button>
  );
}

/** Icon-only button: the label is required (aria-label and tooltip text). */
export function IconButton({ icon, label, variant = "ghost", size = "md", className, busy, as, disabled, ...rest }:
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "as"> & { icon: IconName; label: string; variant?: ButtonVariant; size?: ButtonSize } & BusyProps) {
  const on = Boolean(busy);
  return (
    <button type="button" aria-label={label} title={label} aria-busy={on || undefined} disabled={disabled || on} className={buttonClass(variant, size, cx("mz-btn--icon", className))} {...rest}>
      {on && as ? <BusyLoader pending={busyKind(as)} size={16} /> : <Icon name={icon} size={16} />}
    </button>
  );
}

/** Buttons side by side, 8px apart. */
export function ButtonGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("mz-btn-group flex-wrap", className)}>{children}</div>;
}

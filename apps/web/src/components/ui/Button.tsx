import { Icon, type IconProps } from "@mizan/design-system/icons/react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { PendingEvent, WaitMeaning } from "@mizan/shared/motion";
import { cx } from "./logic";
import { BusyLabel, BusyLoader, busyLoaderKind } from "./BusyLabel";

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

/** A running mutation that names its catalogue event (useEventMutation). */
export interface EventBusy<E extends string = string> { isPending: boolean; motion: E }

/**
 * What a busy control is doing, never an animation. One of:
 *   busy absent or false                    idle
 *   busy={x.isPending} as="saving"          a meaning (WaitMeaning): loading, signingIn, checking,
 *                                           syncing, sending, saving, creating
 *   busy={m}                                a useEventMutation whose event carries an action
 *   busy={m} as="sending"                   any event mutation, with the meaning named
 * A bare `busy={x.isPending}` with no `as` is a type error (and the busy-needs-meaning lint rule),
 * so nothing falls back to the save animation. Rows in a list key busy by `mutation.variables`
 * (`busy={act.isPending && act.variables === row.id}`) so only the pressed row animates.
 */
export type BusyProps =
  | { busy?: false | null; as?: WaitMeaning }
  | { busy: boolean; as: WaitMeaning }
  | { busy: EventBusy<PendingEvent>; as?: WaitMeaning }
  | { busy: EventBusy; as: WaitMeaning };

/** Whether the control is busy, and the loader it plays (the named meaning wins over the event). */
export function busyState(busy: BusyProps["busy"], as: WaitMeaning | undefined) {
  const on = busy == null || busy === false ? false : busy === true ? true : busy.isPending;
  const event = busy && typeof busy === "object" ? busy.motion : undefined;
  return { on, kind: on ? busyLoaderKind(as, event) : undefined };
}

/**
 * `busy` keeps the width: the label stays (invisible) and a 16 px mono Brand 2.0 loader sits on
 * top. The loader follows what the press does (BusyProps): reading or checking = pair, sending out
 * or syncing = transfer, a write in Mizan = drop. There is no default and no FILL here: measured
 * progress is FillProgress with a value. Never red. When the work ends, the label settles back in.
 */
export function Button({ variant = "primary", size = "md", busy, as, icon, iconEnd, className, children, disabled, ...rest }:
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "as"> & { variant?: ButtonVariant; size?: ButtonSize; icon?: IconName; iconEnd?: IconName } & BusyProps) {
  const { on, kind } = busyState(busy, as);
  return (
    <button type="button" aria-busy={on || undefined} disabled={disabled || on} className={buttonClass(variant, size, cx("relative", className))} {...rest}>
      <BusyLabel busy={on}>
        {icon ? <Icon name={icon} size={16} /> : null}
        {children}
        {iconEnd ? <Icon name={iconEnd} size={16} /> : null}
      </BusyLabel>
      {on && kind ? <span className="absolute inset-0 grid place-items-center"><BusyLoader pending={kind} /></span> : null}
    </button>
  );
}

/** Icon-only button: the label is required (aria-label and tooltip text). `busy` as on Button. */
export function IconButton({ icon, label, variant = "ghost", size = "md", className, busy, as, disabled, ...rest }:
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "as"> & { icon: IconName; label: string; variant?: ButtonVariant; size?: ButtonSize } & BusyProps) {
  const { on, kind } = busyState(busy, as);
  return (
    <button type="button" aria-label={label} title={label} aria-busy={on || undefined} disabled={disabled || on} className={buttonClass(variant, size, cx("mz-btn--icon", className))} {...rest}>
      {on && kind ? <BusyLoader pending={kind} size={16} /> : <Icon name={icon} size={16} />}
    </button>
  );
}

/** Buttons side by side, 8px apart. */
export function ButtonGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("mz-btn-group flex-wrap", className)}>{children}</div>;
}

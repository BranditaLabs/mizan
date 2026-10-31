import { Icon, type IconProps } from "@mizan/design-system/icons/react";
import type { ReactNode } from "react";
import { cx } from "./logic";

/** Inline alert (components.md §6, `.mz-alert`): soft background, icon, bold lead, plain sentence. */
const ICONS: Record<"info" | "success" | "warning" | "danger", IconProps["name"]> = { info: "info", success: "success", warning: "warning", danger: "error" };

export function Alert({ tone = "info", title, children }: { tone?: keyof typeof ICONS; title?: ReactNode; children?: ReactNode }) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cx("mz-alert", tone !== "info" && `mz-alert--${tone}`)}>
      <Icon name={ICONS[tone]} size={16} className="mt-0.5 shrink-0" />
      <div>
        {title ? <b>{title}</b> : null}
        {title && children ? " " : null}
        {children}
      </div>
    </div>
  );
}

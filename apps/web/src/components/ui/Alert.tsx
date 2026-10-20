import { Icon, type IconProps } from "@mizan/design-system/icons/react";
import type { ReactNode } from "react";

/** Inline alert (components.md §6): soft background, icon, plain sentence. */
const TONES: Record<"info" | "success" | "warning" | "danger", { box: string; icon: IconProps["name"] }> = {
  info: { box: "bg-info-soft text-info-text", icon: "info" },
  success: { box: "bg-success-soft text-success-text", icon: "success" },
  warning: { box: "bg-warning-soft text-warning-text", icon: "warning" },
  danger: { box: "bg-danger-soft text-danger-text", icon: "error" },
};

export function Alert({ tone = "info", children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  const t = TONES[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={`flex items-start gap-2.5 rounded-md px-3.5 py-3 text-body-sm ${t.box}`}>
      <Icon name={t.icon} size={16} className="mt-0.5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

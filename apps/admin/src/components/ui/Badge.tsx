import { Icon, type IconProps } from "@mizan/design-system/icons/react";
import type { ReactNode } from "react";
import { cx, riskLevel } from "./logic";

/**
 * Status badge (components.md §4, `.mz-badge`): always text, colour is never the only signal.
 * success = delivered / paid / confirmed · info = in transit · warning = pending · danger = refused / failed ·
 * neutral = new / draft / unknown · ink = strong neutral (Paid, Final), no dot.
 */
export type BadgeTone = "neutral" | "success" | "info" | "warning" | "danger" | "ink";

export function Badge({ tone = "neutral", dot = true, children, className }: { tone?: BadgeTone; dot?: boolean; children: ReactNode; className?: string }) {
  return <span className={cx("mz-badge", tone !== "neutral" && `mz-badge--${tone}`, (!dot || tone === "ink") && "mz-badge--plain", className)}>{children}</span>;
}

/** Neutral tag (channels, labels); with an icon for payment methods. */
export function Tag({ icon, children, className }: { icon?: IconProps["name"]; children: ReactNode; className?: string }) {
  return (
    <span className={cx("mz-tag gap-1.5", className)}>
      {icon ? <Icon name={icon} size={14} /> : null}
      {children}
    </span>
  );
}

/** Payment methods (docs/12) and their icons: never assume an order is cash on delivery. */
export const PAYMENT_ICONS = {
  cod: "cod", card: "card", wallet: "wallet", deposit: "deposit", bnpl: "bnpl", bank_transfer: "bank-transfer",
} as const satisfies Record<string, IconProps["name"]>;
export type PaymentMethod = keyof typeof PAYMENT_ICONS;

export function PaymentTag({ method, label }: { method: PaymentMethod; label: string }) {
  return <Tag icon={PAYMENT_ICONS[method]}>{label}</Tag>;
}

/**
 * Risk meter (`.mz-risk`): 44px bar + score in mono. The score is always printed and `label` says
 * what it means ("High risk: 82"); reasons belong in a tooltip or the side panel.
 */
export function RiskMeter({ score, label }: { score: number; label: string }) {
  const level = riskLevel(score);
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  return (
    <span className={cx("mz-risk", level !== "low" && `mz-risk--${level}`)} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={clamped} aria-label={label}>
      <span className="mz-risk__bar" aria-hidden="true"><i style={{ width: `${clamped}%` }} /></span>
      <bdi dir="ltr">{clamped}</bdi>
    </span>
  );
}

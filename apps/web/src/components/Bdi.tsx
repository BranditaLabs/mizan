import type { ReactNode } from "react";

/**
 * Isolates numbers, phones, order ids, SKUs and URLs inside text of the other direction
 * (docs/08 §3). `code` values (order ids, phones, SKUs, tracking numbers) are laid out left to
 * right in Geist Mono (`mz-id`): "#1042" has no strong characters, so a plain <bdi> inside Arabic
 * would show "1042#". Formatted amounts keep `auto`, so "1,150.00 ج.م." reads naturally in Arabic.
 */
export function Bdi({ children, code = false }: { children: ReactNode; code?: boolean }) {
  return code ? <bdi dir="ltr" className="mz-id font-mono font-medium">{children}</bdi> : <bdi className="mz-num">{children}</bdi>;
}

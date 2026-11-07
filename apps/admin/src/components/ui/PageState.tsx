"use client";

import { MizanLoader } from "@mizan/design-system/react/motion";
import { useTranslations } from "next-intl";
import { SkeletonRows } from "./Surface";
import { cx } from "./logic";

/**
 * What a screen shows while it has no data yet (Brand 2.0 "pair": page or data loading).
 *   variant="list"  still skeleton rows with a 20 px pair in the head
 *   variant="card"  a centred 48 px pair
 *   variant="page"  a 96 px pair in the brand tone (claims the view's one red)
 */
export function PageState({ variant = "list", label, rows, className }: { variant?: "list" | "card" | "page"; label?: string; rows?: number; className?: string }) {
  const t = useTranslations("motion.loader");
  const text = label ?? t("loading");
  if (variant === "list") return <SkeletonRows rows={rows} label={text} />;
  return (
    <div className={cx("grid place-items-center text-text", variant === "page" ? "min-h-[60dvh] py-10" : "py-6", className)} data-testid="page-state">
      <MizanLoader kind="pair" size={variant === "page" ? 96 : 48} tone={variant === "page" ? "brand" : "mono"} label={text} />
    </div>
  );
}

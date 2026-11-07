"use client";

import type { MotionDispatch } from "@mizan/design-system/motion";
import { EventGlyph } from "@mizan/design-system/react/motion";
import type { Outcome } from "@mizan/shared/motion";
import { useCallback, useState, type ReactNode } from "react";
import { useSurface } from "@/lib/motion/EventMotionProvider";
import { cx } from "./logic";

/** Outcomes a surface plays as its own settle (the glyph says which). */
const PLAYS = new Set(["settle", "done", "merge", "drop", "tip", "fail"]);

/**
 * A catalogue surface (card, list, kpi, queue, banner, instrument) on screen: it subscribes to the
 * motion provider while mounted, so the catalogue's dispatches to it are not dropped, and plays
 * each one. The content settles again (SETTLE, never on mount) and, with `glyph`, the outcome's
 * glyph plays once at the inline start (done draws its check, tip holds, a DROP claims the red
 * through the budget). `entityId` keeps an order's cards to that order's events. Children are
 * never remounted; reduced motion crossfades (motion.css).
 */
export function MotionSurface({ surface, entityId, glyph = false, inline = false, className, children, testId }: {
  surface: "card" | "list" | "kpi" | "queue" | "banner" | "instrument";
  entityId?: string;
  glyph?: boolean;
  inline?: boolean;
  className?: string;
  children: ReactNode;
  testId?: string;
}) {
  const filter = useCallback((d: MotionDispatch) => PLAYS.has(d.outcome) && (entityId === undefined || d.entityId === undefined || d.entityId === entityId), [entityId]);
  const last = useSurface(surface, filter);
  // Each dispatch is a new object: count them to restart the settle (two identical keyframes, alternated).
  const [seen, setSeen] = useState<{ d: MotionDispatch | null; n: number }>({ d: null, n: 0 });
  if (last !== seen.d) setSeen({ d: last, n: seen.n + 1 });
  const n = last ? seen.n : 0;
  const Tag = inline ? "span" : "div";
  return (
    <Tag className={cx(className, n > 0 && (n % 2 ? "mz-settle-in" : "mz-settle-in-b"), glyph && "inline-flex items-center gap-2")} data-mz-surface={surface} data-outcome={last?.outcome} data-testid={testId}>
      {glyph && last ? <EventGlyph key={n} outcome={last.outcome as Outcome} size={14} /> : null}
      {children}
    </Tag>
  );
}

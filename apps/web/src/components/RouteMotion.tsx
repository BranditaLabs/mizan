"use client";

import { getReduced, MOTION } from "@mizan/design-system/motion";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";

/**
 * Continuity between screens: when the path changes, the new screen rises into place (the rise
 * distance, `duration.route`, the enter easing; all motion tokens). The content is visible by default
 * and is never remounted, so a failed script or reduced motion simply shows it; reduced motion keeps
 * a short fade. The one allow-listed `.animate()` in the app (lint: mizan/no-adhoc-motion).
 */
export function RouteMotion({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const el = ref.current;
    if (!el?.animate) return;
    const reduce = getReduced();
    const anim = el.animate(
      reduce ? [{ opacity: 0.4 }, { opacity: 1 }] : [{ opacity: 0, transform: `translateY(${MOTION.distance.rise}px)` }, { opacity: 1, transform: "none" }],
      { duration: reduce ? MOTION.reduced.route : MOTION.duration.route, easing: MOTION.easing.enter },
    );
    return () => anim.cancel();
  }, [pathname]);

  return <div ref={ref} className="min-h-full">{children}</div>;
}

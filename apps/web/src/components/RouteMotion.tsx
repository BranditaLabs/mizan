"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";

/**
 * Continuity between screens: when the path changes, the new screen rises into place (8px, 280ms,
 * decelerating). The content is visible by default and is never remounted, so a failed script or
 * reduced motion simply shows it; reduced motion keeps a short fade.
 */
export function RouteMotion({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const el = ref.current;
    if (!el?.animate) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const anim = el.animate(
      reduce ? [{ opacity: 0.4 }, { opacity: 1 }] : [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }],
      { duration: reduce ? 120 : 280, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
    );
    return () => anim.cancel();
  }, [pathname]);

  return <div ref={ref} className="min-h-full">{children}</div>;
}

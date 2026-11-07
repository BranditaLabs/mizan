"use client";

import { RedBudgetProvider } from "@mizan/design-system/react/motion";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * One red per view (Brand 2.0): every red holder (a toast's DROP, the page loader) claims from this
 * budget, reset on each route. The back office has no live source: its motion is the design
 * system's components and the engine catalogue's static glyphs (@mizan/shared/motion).
 */
export function ViewRedBudget({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return <RedBudgetProvider resetKey={pathname}>{children}</RedBudgetProvider>;
}

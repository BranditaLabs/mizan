"use client";
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { defaultRedBudget, RedBudget } from "../../motion/red-budget";

const Ctx = createContext<RedBudget>(defaultRedBudget);

/**
 * One red per view: mount at the route root (inside RouteMotion) with the pathname as `resetKey`,
 * so a new route starts with nobody holding the red.
 */
export function RedBudgetProvider({ resetKey, children }: { resetKey?: string; children: ReactNode }) {
  // A new budget per view: the holders of the old route release into the old one, and the new
  // route's claimants (whose effects depend on the budget) claim afresh.
  const budget = useMemo(() => { void resetKey; return new RedBudget(); }, [resetKey]);
  return <Ctx.Provider value={budget}>{children}</Ctx.Provider>;
}

export const useRedBudget = () => useContext(Ctx);

/**
 * Whether `id` holds the red. `want` false releases it. `ttlMs` releases it after that long (a DROP
 * after its ripple). False on the server: the red arrives after hydration, so markup matches.
 */
export function useRed(id: string, priority: number, want = true, ttlMs?: number): boolean {
  const budget = useRedBudget();
  useEffect(() => {
    if (!want) return;
    budget.claim(id, priority, ttlMs != null ? { ttlMs } : {});
    return () => budget.release(id);
  }, [budget, id, priority, want, ttlMs]);
  return useSyncExternalStore(budget.subscribe, () => want && budget.has(id), () => false);
}

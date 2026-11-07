"use client";
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { defaultRedBudget, RED_PRIORITY, RedBudget } from "../../motion/red-budget";

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

/**
 * Whether anybody holds the view's red. A full-colour logo that is the view's red when nothing else
 * is (the auth header) turns mono while a DROP or a verdict holds it. False on the server.
 */
export function useRedTaken(): boolean {
  const budget = useRedBudget();
  return useSyncExternalStore(budget.subscribe, () => budget.holder() !== null, () => false);
}

/**
 * A plain shape in the brand red that takes its turn in the view's budget (the owner home's kept
 * share: the money side). `claim` groups shapes that are one red (a bar and its legend dot); while
 * something better holds the red, the shape is `fallback` (the ink it sits among). App code never
 * paints the red itself (mizan/no-brand-red); it renders this.
 */
export function RedSwatch({ claim, fallback = "currentColor", className, style }: { claim: string; fallback?: string; className?: string; style?: CSSProperties }) {
  const red = useRed(`swatch:${claim}`, RED_PRIORITY.dot, true);
  return <span aria-hidden="true" className={className} data-mz-red={red ? "on" : "off"} style={{ ...style, background: red ? "var(--mz-red)" : fallback }} />;
}

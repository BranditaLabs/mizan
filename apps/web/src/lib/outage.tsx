"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { API_URL, ApiError } from "./api/client";

/**
 * Mizan out of service: the API gives no answer, or a gateway says it is down (502/503/504) after
 * the query retries. One such failure puts the whole dashboard behind the waiting screen
 * (components/OutageScreen), which checks /health/ready on its own and lifts when the API is back.
 * Other errors (4xx, a 500 from one route) stay where they happen.
 */
export function isOutage(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 0 || error.status === 502 || error.status === 503 || error.status === 504);
}

/** Seconds before the next check: 5, 10, 20, then every 30. */
export const nextCheckIn = (attempt: number) => Math.min(5 * 2 ** attempt, 30);

/** Is the API ready to serve? No answer, a timeout or any non-2xx counts as no. */
export async function apiReady(fetchFn: typeof fetch = fetch, timeoutMs = 8000): Promise<boolean> {
  try {
    const res = await fetchFn(`${API_URL}/health/ready`, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

interface Outage {
  down: boolean;
  /** Called for every failed query or action; switches the waiting screen on for an outage. */
  report(error: unknown): void;
  /** The API answered again. */
  restored(): void;
}

const OutageContext = createContext<Outage>({ down: false, report: () => undefined, restored: () => undefined });

export function OutageProvider({ children }: { children: ReactNode }) {
  const [down, setDown] = useState(false);
  const report = useCallback((error: unknown) => { if (isOutage(error)) setDown(true); }, []);
  const restored = useCallback(() => setDown(false), []);
  const value = useMemo(() => ({ down, report, restored }), [down, report, restored]);
  return <OutageContext.Provider value={value}>{children}</OutageContext.Provider>;
}

export const useOutage = () => useContext(OutageContext);

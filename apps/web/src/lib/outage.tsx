"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { API_URL, ApiError } from "./api/client";

/** Gateway statuses that can mean Mizan is down. */
const GATEWAY = new Set([502, 503, 504]);
/** Problem codes with which Mizan itself says it cannot serve (the database is unreachable). */
const DOWN_CODES = new Set(["service_unavailable"]);

/**
 * Mizan out of service: the API gives no answer, or a gateway says it is down (502/503/504 without
 * a Mizan problem body: code "unknown"), or Mizan says it cannot serve at all, after the query
 * retries. One such failure puts the whole dashboard behind the waiting screen
 * (components/OutageScreen), which checks /health/ready on its own and lifts when the API is back.
 * A 502/503 that Mizan answers with its own problem code is a working API reporting one thing
 * (Shopify not configured on the server, a courier not answering): it stays where it happens, like
 * 4xx and a route's own 500.
 */
export function isOutage(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.status === 0) return true;
  return GATEWAY.has(error.status) && (error.code === "unknown" || DOWN_CODES.has(error.code));
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

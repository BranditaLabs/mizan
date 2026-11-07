"use client";
import { useSyncExternalStore } from "react";
import { getReduced, getServerReduced, subscribeReduced } from "../../motion/reduced";

/** prefers-reduced-motion (or the forced store), false on the server and during hydration. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduced, getReduced, getServerReduced);
}

"use client";
import { useSyncExternalStore } from "react";

/** auth.css §12: landscape phones hide the auth stage. */
export const STAGE_HIDDEN_QUERY = "(max-height: 500px) and (orientation: landscape)";
/** auth.css §9: below 768px the stage (the phone strip) hides while the on-screen keyboard is open. */
const NARROW_QUERY = "(max-width: 767.98px)";

const media = (q: string) => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(q) : null);
const subscribe = (cb: () => void) => {
  const qs = [media(STAGE_HIDDEN_QUERY), media(NARROW_QUERY)].filter((q): q is MediaQueryList => q !== null);
  qs.forEach((q) => q.addEventListener("change", cb));
  return () => qs.forEach((q) => q.removeEventListener("change", cb));
};
const short = () => media(STAGE_HIDDEN_QUERY)?.matches ?? false;
const narrow = () => media(NARROW_QUERY)?.matches ?? false;

/**
 * Whether the auth stage (web and staff) is hidden by the screen's shape: a landscape phone, or a
 * phone with its keyboard open (`keyboard`, from the frame's keyboard watch). A hidden stage must
 * not hold the view's one red (its mark passes `claim={!hidden}`). False on the server.
 */
export function useStageHidden(keyboard = false): boolean {
  const isShort = useSyncExternalStore(subscribe, short, () => false);
  const isNarrow = useSyncExternalStore(subscribe, narrow, () => false);
  return isShort || (keyboard && isNarrow);
}

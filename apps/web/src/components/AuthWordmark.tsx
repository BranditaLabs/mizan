"use client";
import { useRedTaken } from "@mizan/design-system/react/motion";
import { ThemedWordmark } from "./Wordmark";

/**
 * The auth header's wordmark: full colour (the view's one red, D4) until something in the view
 * holds the red (DoneState's DROP on the signed-in step), then mono until it is released.
 */
export function AuthWordmark() {
  const taken = useRedTaken();
  return <ThemedWordmark tone={taken ? "mono" : "auto"} />;
}

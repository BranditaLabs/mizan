"use client";
import { useRedTaken } from "@mizan/design-system/react/motion";
import { ThemedWordmark } from "./Wordmark";

/**
 * The auth header's wordmark: full colour (the view's one red, D4) until something in the view
 * holds the red (the stage's mark, DoneState's DROP on the signed-in step), then mono until it is
 * released. Beside the auth stage (`staged`) it starts mono (server and hydration): the stage's mark
 * claims the red right after, so the red never shows on the wordmark first and then hops to the mark.
 */
export function AuthWordmark({ staged = false }: { staged?: boolean }) {
  const taken = useRedTaken(staged);
  return <ThemedWordmark tone={taken ? "mono" : "auto"} />;
}

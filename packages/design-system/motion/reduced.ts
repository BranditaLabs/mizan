/**
 * The reduced-motion store: `prefers-reduced-motion: reduce`, read lazily (no matchMedia at module
 * scope) and on the server always false, so the server and the first client render agree. A forced
 * value (the gallery's "reduced" toggle, tests) wins over the system.
 */
type Listener = () => void;

const listeners = new Set<Listener>();
let mql: MediaQueryList | null = null;
let forced: boolean | null = null;

const media = () => {
  if (!mql && typeof window !== "undefined" && typeof window.matchMedia === "function") {
    mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    mql.addEventListener?.("change", emit);
  }
  return mql;
};

function emit() { for (const l of listeners) l(); }

export function getReduced(): boolean {
  if (forced !== null) return forced;
  return media()?.matches ?? false;
}

/** The server snapshot: motion is never reduced in the HTML, the client corrects it after hydration. */
export const getServerReduced = () => false;

export function subscribeReduced(listener: Listener): () => void {
  media();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Force reduced motion on (true), off (false) or back to the system (null). */
export function forceReduced(value: boolean | null) {
  forced = value;
  emit();
}

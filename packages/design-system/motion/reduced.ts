/**
 * The reduced-motion store: `prefers-reduced-motion: reduce`, read lazily (no matchMedia at module
 * scope) and on the server always false, so the server and the first client render agree. A forced
 * "on" (the gallery's "reduced" toggle, tests) wins over the system; a forced "off" never undoes a
 * system reduce, so JS and CSS always agree.
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
  const system = media()?.matches ?? false;
  // Forced off cannot undo the system's reduce (the CSS @media block still applies): the system wins.
  if (forced !== null) return forced || system;
  return system;
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
  // The CSS side reads the same store: data-mz-reduced on <html> applies the reduced tokens and
  // keyframes to the whole page (toasts and portals too), not only to the element that asked.
  if (typeof document !== "undefined") {
    if (value) document.documentElement.setAttribute("data-mz-reduced", "true");
    else document.documentElement.removeAttribute("data-mz-reduced");
  }
  emit();
}

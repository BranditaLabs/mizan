/** Whether the viewer asked for less motion (the typing delay and every scroll follow it). */
export const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A scroll's behaviour: smooth, unless the viewer asked for less motion (an explicit "smooth" overrides the CSS). */
export const scrollBehavior = (): ScrollBehavior => (reducedMotion() ? "auto" : "smooth");

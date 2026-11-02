/** Where to go after sign-in: a path inside this app only (never another origin), default home. */
export function safeNext(raw: string | string[] | undefined): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : "/";
}

const RESUME = "mizan.resume";

/**
 * Where to come back to after a detour through welcome (create the store) and two-step: the page
 * someone was sent away from, such as the Shopify install's one-time link. Kept in this tab only
 * (the Shopify consent screen returns to the same tab), checked like `next`.
 */
export const resume = {
  save(path: string) {
    if (safeNext(path) === "/" || path.startsWith("/welcome") || path.startsWith("/security/")) return;
    try { sessionStorage.setItem(RESUME, path); } catch { /* storage off: the detour ends at home */ }
  },
  peek(): string | null {
    try { const v = sessionStorage.getItem(RESUME); return v && safeNext(v) !== "/" ? v : null; } catch { return null; }
  },
  take(): string | null {
    const v = resume.peek();
    try { sessionStorage.removeItem(RESUME); } catch { /* nothing to clear */ }
    return v;
  },
};

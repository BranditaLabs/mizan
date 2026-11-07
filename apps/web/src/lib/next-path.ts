// C0 and C1 control characters: browsers drop tabs and newlines inside URLs ("/<TAB>/evil.com" becomes "//evil.com").
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/;

/**
 * Where to go after sign-in: a path inside this app only (never another origin), default home.
 * It must start with one "/", and hold no backslash (browsers read "\\" as "/") and no control
 * character, also once percent-decoded ("/%5C" and "/%09").
 */
export function safeNext(raw: string | string[] | undefined): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v || !v.startsWith("/") || v.startsWith("//") || v.includes("\\") || CONTROL.test(v)) return "/";
  let decoded = v;
  try { decoded = decodeURIComponent(v); } catch { return "/"; }
  if (decoded.startsWith("//") || decoded.includes("\\") || CONTROL.test(decoded)) return "/";
  return v;
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

/** The sign-in link that brings someone back to `from`; `ended` adds the "your session ended" note (reason=expired). */
export function signInPath(from: string, ended = false): string {
  return `/sign-in?${ended ? "reason=expired&" : ""}next=${encodeURIComponent(from)}`;
}

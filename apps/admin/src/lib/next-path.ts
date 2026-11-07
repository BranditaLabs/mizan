// C0 and C1 control characters: browsers drop tabs and newlines inside URLs ("/<TAB>/evil.com" becomes "//evil.com").
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/;

/**
 * Where to go after the staff sign-in: a path inside the back office only (never another origin),
 * default home. Same rule as the dashboard's (apps/web lib/next-path.ts): one leading "/", no
 * backslash, no control character, also once percent-decoded.
 */
export function safeNext(raw: string | null | undefined): string {
  const v = raw ?? "";
  if (!v || !v.startsWith("/") || v.startsWith("//") || v.includes("\\") || CONTROL.test(v)) return "/";
  let decoded = v;
  try { decoded = decodeURIComponent(v); } catch { return "/"; }
  if (decoded.startsWith("//") || decoded.includes("\\") || CONTROL.test(decoded)) return "/";
  return v;
}

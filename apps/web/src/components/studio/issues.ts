/**
 * Where a problem belongs in the studio. Two sources, one shape: the preview's `issues` (paths as
 * arrays, inside the script: ["texts", "ar", "confirmed"]) and a refused save's 422 `errors`
 * (paths as strings from the settings root: "script.texts.ar.confirmed", "steps.1.waitMinutes").
 */
export type Lang = "ar" | "en";
export interface RawIssue { path: string | ReadonlyArray<string | number>; code: string; limit?: number; length?: number; variable?: string }

export type Target =
  | { area: "text"; lang: Lang; key: string }
  | { area: "reason"; index: number; field: "title" | "description" | "id" | "code" | null; lang: Lang | null }
  | { area: "reasons" }
  | { area: "steps"; index: number | null }
  | { area: "team" }
  | { area: "script" }
  | { area: "other" };

export interface StudioIssue { target: Target; code: string; limit?: number; length?: number; variable?: string }

const isLang = (x: unknown): x is Lang => x === "ar" || x === "en";

/** `inScript`: the path starts inside the script (preview issues), not at the settings root. */
export function targetOf(path: RawIssue["path"], inScript: boolean): Target {
  const parts = (typeof path === "string" ? path.split(".").filter(Boolean) : [...path]).map((p) => (typeof p === "string" && /^\d+$/.test(p) ? Number(p) : p));
  const p = inScript ? parts : parts[0] === "script" ? parts.slice(1) : null;
  if (!p) {
    if (parts[0] === "steps") return { area: "steps", index: typeof parts[1] === "number" ? parts[1] : null };
    if (parts[0] === "teamCalls" || parts[0] === "callingHours") return { area: "team" };
    return { area: "other" };
  }
  if (p[0] === "texts" && isLang(p[1]) && typeof p[2] === "string") return { area: "text", lang: p[1], key: p[2] };
  if (p[0] === "cancelReasons") {
    if (typeof p[1] !== "number") return { area: "reasons" };
    const field = p[2] === "title" || p[2] === "description" || p[2] === "id" || p[2] === "code" ? p[2] : null;
    return { area: "reason", index: p[1], field, lang: isLang(p[3]) ? p[3] : null };
  }
  return { area: "script" };
}

export function toIssues(raw: readonly RawIssue[] | undefined, inScript: boolean): StudioIssue[] {
  return (raw ?? []).map((r) => ({
    target: targetOf(r.path, inScript), code: r.code,
    ...(r.limit !== undefined ? { limit: r.limit } : {}), ...(r.length !== undefined ? { length: r.length } : {}), ...(r.variable ? { variable: r.variable } : {}),
  }));
}

export const forText = (issues: readonly StudioIssue[], lang: Lang, key: string) =>
  issues.filter((i) => i.target.area === "text" && i.target.lang === lang && i.target.key === key);

export const forReason = (issues: readonly StudioIssue[], index: number, lang: Lang | null = null) =>
  issues.filter((i) => i.target.area === "reason" && i.target.index === index && (lang === null || i.target.lang === null || i.target.lang === lang));

/** The issue codes the studio words (anything else reads as a generic problem). */
export const KNOWN_CODES = [
  "too_long", "unknown_variable", "variable_not_here", "missing_variable", "only_variables", "no_variables_in_titles", "no_new_lines", "no_links",
  "template_safe", "duplicate_title", "duplicate_id", "reason_title_required", "not_a_key", "invalid_text", "invalid_pack", "invalid_reasons", "invalid_script",
] as const;
export type KnownCode = (typeof KNOWN_CODES)[number];
export const knownCode = (code: string): KnownCode | "other" => ((KNOWN_CODES as readonly string[]).includes(code) ? (code as KnownCode) : "other");

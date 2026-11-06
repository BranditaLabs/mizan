/**
 * Where a problem belongs in the studio. Two sources, one shape: the preview's `issues` (paths as
 * arrays, inside the script: ["texts", "ar", "confirmed"]) and a refused save's 422 `errors`
 * (paths as strings from the settings root: "script.texts.ar.confirmed", "steps.1.waitMinutes").
 */
import { estimateLength, missingRequired, type Widths } from "./length";

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

/**
 * One list of a refused save's problems and the live preview's: the same rule on the same place
 * shows once (both come from the API's validateScript), the save's first.
 */
export function mergeIssues(...lists: ReadonlyArray<readonly StudioIssue[]>): StudioIssue[] {
  const seen = new Set<string>();
  const out: StudioIssue[] = [];
  for (const i of lists.flat()) {
    const id = JSON.stringify([i.target, i.code, i.variable ?? null]);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(i);
  }
  return out;
}

export type TextsByLang =Partial<Record<Lang, Readonly<Record<string, string | undefined>>>>;

/** The API's rule (confirmation.service `unchanged`): a text the same as the stored one, trimmed. */
export const textUnchanged = (stored: TextsByLang | undefined, draft: TextsByLang, lang: Lang, key: string) =>
  (draft[lang]?.[key] ?? "").trim() === (stored?.[lang]?.[key] ?? "").trim();

/**
 * The texts the client can already tell a save would refuse: only texts the draft changed, like
 * the API, which never refuses a text that is unchanged from the stored script (a stored text that
 * no longer fits, e.g. after the store was renamed, never blocks saving the rest). `issues`: the
 * live preview's problems, counted on changed texts only.
 */
export function refusedTexts(p: {
  draft: TextsByLang;
  stored: TextsByLang | undefined;
  keys: ReadonlyArray<{ key: string; limit: number; required: readonly string[] }>;
  widths: Widths;
  storeName: string | null;
  issues?: readonly StudioIssue[];
}): Array<{ lang: Lang; key: string }> {
  const out: Array<{ lang: Lang; key: string }> = [];
  for (const lang of ["ar", "en"] as const) {
    for (const k of p.keys) {
      const v = p.draft[lang]?.[k.key];
      if (!v || textUnchanged(p.stored, p.draft, lang, k.key)) continue;
      const flagged = p.issues?.some((i) => i.target.area === "text" && i.target.lang === lang && i.target.key === k.key);
      if (flagged || estimateLength(v, p.widths, p.storeName) > k.limit || missingRequired(v, k.required).length) out.push({ lang, key: k.key });
    }
  }
  return out;
}

export const forText =(issues: readonly StudioIssue[], lang: Lang, key: string) =>
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

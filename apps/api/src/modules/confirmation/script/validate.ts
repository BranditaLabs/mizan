import { z } from "zod";
import {
  DEFAULT_SCRIPT, isVariable, KEY_SPEC, PACKS, ReasonItemSchema, SCRIPT_KEYS, ScriptDraftSchema, VAR_WIDTH, VARIABLE, variablesIn,
  type KeyKind, type Pack, type ReasonItem, type Script, type ScriptKey,
} from "./catalogue.js";
import { MAX_BUYER_REASONS } from "@mizan/shared";
import { PACK_REASONS, PACK_TEXTS, packReasonTitle } from "./packs.js";
import { AR_VARIANTS, type ArabicVariant } from "../templates.js";

export const ISSUE_CODES = [
  "too_long", "unknown_variable", "variable_not_here", "missing_variable", "only_variables", "no_variables_in_titles", "no_new_lines", "no_links",
  "template_safe", "duplicate_title", "duplicate_id", "reason_title_required", "not_a_key", "invalid_text", "invalid_pack", "invalid_reasons", "invalid_script", "invalid_template",
] as const;
export type IssueCode = (typeof ISSUE_CODES)[number];
/** Where and what, never the owner's text. */
export interface Issue { path: Array<string | number>; code: IssueCode; limit?: number; length?: number; variable?: string }
export const IssueSchema = z.object({
  path: z.array(z.union([z.string(), z.number().int()])).describe("e.g. [\"texts\", \"en\", \"btn_offer_yes\"] or [\"cancelReasons\", 3, \"title\", \"ar\"]"),
  code: z.enum(ISSUE_CODES),
  limit: z.number().int().optional(),
  length: z.number().int().optional(),
  variable: z.string().optional(),
});

const TITLES: readonly KeyKind[] = ["button", "list_button", "row", "section"];
const ONE_LINE: readonly KeyKind[] = [...TITLES, "row_description", "fragment", "template_fragment", "header", "footer"];
const NO_LINKS_KEYS: readonly ScriptKey[] = ["on_delivery", "opted_out", "opted_in"];
const LINK = /(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|io|me|ly|co|app|eg|sa|ae|shop|store|link)\b/i;
const EMOJI = /\p{Extended_Pictographic}/u;

/** The length a text can reach: each variable at its catalogue width, the store's name at its real length when known. */
export function estimateLength(text: string, storeName: string | null = null): number {
  return text.replace(VARIABLE, (whole: string, name: string) => {
    if (name === "store.name") return "x".repeat(storeName?.length ?? 1);
    return isVariable(name) ? "x".repeat(VAR_WIDTH[name]) : whole;
  }).length;
}

/** The rules for one text (an override, a reason's title or description) under a key's spec. */
function checkText(text: string, path: Issue["path"], s: { kind: KeyKind; limit: number; vars: readonly string[]; required: readonly string[]; key?: ScriptKey }, storeName: string | null): Issue[] {
  const out: Issue[] = [];
  const used = variablesIn(text);
  const title = TITLES.includes(s.kind);
  for (const v of used) {
    if (!isVariable(v)) out.push({ path, code: "unknown_variable", variable: v });
    else if (title) out.push({ path, code: "no_variables_in_titles", variable: v });
    else if (!s.vars.includes(v)) out.push({ path, code: "variable_not_here", variable: v });
  }
  for (const v of s.required) if (!used.includes(v)) out.push({ path, code: "missing_variable", variable: v });
  if (!/[\p{L}\p{N}\p{So}]/u.test(text.replace(VARIABLE, ""))) out.push({ path, code: "only_variables" });
  if (ONE_LINE.includes(s.kind) && /[\r\n]/.test(text)) out.push({ path, code: "no_new_lines" });
  if ((title || s.kind === "row_description" || s.kind === "header" || s.kind === "footer" || (s.key && NO_LINKS_KEYS.includes(s.key))) && LINK.test(text)) out.push({ path, code: "no_links" });
  if (s.kind === "template_fragment" && (LINK.test(text) || /[0-9٠-٩۰-۹]{6,}/.test(text) || EMOJI.test(text) || /\t| {4,}/.test(text))) out.push({ path, code: "template_safe" });
  const length = estimateLength(text, storeName);
  if (length > s.limit) out.push({ path, code: "too_long", limit: s.limit, length });
  return out;
}

const same = (a: string) => a.trim().toLocaleLowerCase();

/**
 * Every rule, per override and per language, with the exact path. `storeName` and `storeLang`
 * are known when saving; a draft without them is checked leniently (the save checks again).
 */
export function validateScript(script: Script, ctx: { storeName: string | null; storeLang: "ar" | "en" | null }): Issue[] {
  const out: Issue[] = [];
  const pack: Pack = script.pack;
  for (const lang of ["ar", "en"] as const) {
    const texts = script.texts[lang] ?? {};
    for (const [key, text] of Object.entries(texts) as Array<[ScriptKey, string | undefined]>) {
      if (!text) continue;
      out.push(...checkText(text, ["texts", lang, key], { ...KEY_SPEC[key], key }, ctx.storeName));
    }
    const eff = (key: ScriptKey) => texts[key] ?? PACK_TEXTS[pack][lang][key] ?? "";
    // Two buttons of one message cannot read the same.
    if ((texts.btn_offer_yes || texts.btn_offer_no) && same(eff("btn_offer_yes")) === same(eff("btn_offer_no"))) out.push({ path: ["texts", lang, texts.btn_offer_no ? "btn_offer_no" : "btn_offer_yes"], code: "duplicate_title" });
  }
  const reasons = script.cancelReasons;
  if (reasons) {
    const ids = new Set<string>();
    reasons.forEach((r, i) => {
      if (ids.has(r.id)) out.push({ path: ["cancelReasons", i, "id"], code: "duplicate_id" });
      ids.add(r.id);
      for (const lang of ["ar", "en"] as const) {
        const t = r.title[lang];
        if (t) out.push(...checkText(t, ["cancelReasons", i, "title", lang], { kind: "row", limit: 24, vars: [], required: [] }, ctx.storeName));
        const d = r.description?.[lang];
        if (d) out.push(...checkText(d, ["cancelReasons", i, "description", lang], { kind: "row_description", limit: 72, vars: [], required: [] }, ctx.storeName));
      }
      if (ctx.storeLang ? !r.title[ctx.storeLang] : !r.title.ar && !r.title.en) out.push({ path: ["cancelReasons", i, "title", ...(ctx.storeLang ? [ctx.storeLang] : [])], code: "reason_title_required" });
    });
  }
  // The titles the buyer will see, after the pack fills a missing language: none may repeat.
  const list = reasons ?? (script.texts.ar?.keep_title || script.texts.en?.keep_title ? PACK_REASONS[pack] : null);
  if (list) {
    for (const lang of ["ar", "en"] as const) {
      const seen = new Set<string>();
      list.forEach((r, i) => {
        const t = same(r.title[lang] ?? packReasonTitle(pack, lang, r.code));
        if (seen.has(t)) out.push({ path: ["cancelReasons", i, "title", lang], code: "duplicate_title" });
        seen.add(t);
      });
      const keep = same(script.texts[lang]?.keep_title ?? PACK_TEXTS[pack][lang].keep_title ?? "");
      if (seen.has(keep)) out.push({ path: ["texts", lang, "keep_title"], code: "duplicate_title" });
    }
  }
  return out;
}

/**
 * A saved script's shape. The rules run when saving (`putSettings`), against the stored script and
 * the store's name and language: a text already stored never blocks saving the other settings.
 */
export const ScriptSchema = ScriptDraftSchema;

const SCRIPT_KEY_SET = new Set<string>(SCRIPT_KEYS);
const Reasons = z.array(ReasonItemSchema).min(1).max(MAX_BUYER_REASONS);
const cache = new Map<string, { script: Script | undefined; issues: Issue[] }>();

/**
 * The tolerant reader for a stored script, pure and memoised (every message reads it). Nothing
 * is dropped for its length: `fit` handles that when sending, so renaming the store or a tighter
 * limit never deletes the owner's wording. Dropped: unknown keys and texts with a variable the key
 * cannot use. The result is shared: never mutate it.
 */
export function readScript(raw: unknown): { script: Script | undefined; issues: Issue[] } {
  if (raw === undefined || raw === null) return { script: undefined, issues: [] };
  const memo = JSON.stringify(raw);
  const hit = cache.get(memo);
  if (hit) { cache.delete(memo); cache.set(memo, hit); return hit; }
  const result = parse(raw);
  cache.set(memo, result);
  if (cache.size > 256) cache.delete(cache.keys().next().value!);
  return result;
}

function parse(raw: unknown): { script: Script; issues: Issue[] } {
  if (typeof raw !== "object" || Array.isArray(raw)) return { script: DEFAULT_SCRIPT, issues: [{ path: [], code: "invalid_script" }] };
  const r = raw as { version?: unknown; pack?: unknown; texts?: Record<string, unknown>; cancelReasons?: unknown; template?: unknown };
  const issues: Issue[] = [];
  const pack: Pack = (PACKS as readonly unknown[]).includes(r.pack) ? (r.pack as Pack) : "egyptian";
  if (pack !== r.pack) issues.push({ path: ["pack"], code: "invalid_pack" });
  const texts: Script["texts"] = { ar: {}, en: {} };
  for (const lang of ["ar", "en"] as const) {
    const given = r.texts?.[lang];
    if (!given || typeof given !== "object") continue;
    for (const [key, value] of Object.entries(given as Record<string, unknown>)) {
      const path = ["texts", lang, key];
      if (!SCRIPT_KEY_SET.has(key)) { issues.push({ path, code: "not_a_key" }); continue; }
      if (typeof value !== "string" || !value.trim()) { issues.push({ path, code: "invalid_text" }); continue; }
      const k = key as ScriptKey;
      const s = KEY_SPEC[k];
      const titles = TITLES.includes(s.kind);
      const bad = variablesIn(value).find((v) => !isVariable(v) || titles || !s.vars.includes(v));
      if (bad) { issues.push({ path, code: isVariable(bad) ? (titles ? "no_variables_in_titles" : "variable_not_here") : "unknown_variable", variable: bad }); continue; }
      texts[lang][k] = value.trim();
    }
  }
  let cancelReasons: ReasonItem[] | undefined;
  if (r.cancelReasons !== undefined) {
    const p = Reasons.safeParse(r.cancelReasons);
    const ids = p.success ? new Set(p.data.map((x) => x.id)) : null;
    if (p.success && ids!.size === p.data.length) cancelReasons = p.data;
    else issues.push({ path: ["cancelReasons"], code: "invalid_reasons" });
  }
  // E6-16d: an unknown choice follows the pack, as if none was made.
  const template = (AR_VARIANTS as readonly unknown[]).includes(r.template) ? (r.template as ArabicVariant) : undefined;
  if (r.template !== undefined && !template) issues.push({ path: ["template"], code: "invalid_template" });
  const script: Script = { version: 2, pack, texts, ...(cancelReasons ? { cancelReasons } : {}), ...(template ? { template } : {}) };
  // What no longer fits or breaks a rule is reported (the editor shows it), never dropped.
  for (const i of validateScript(script, { storeName: null, storeLang: null })) if (!issues.some((x) => same(x.path.join(".")) === same(i.path.join(".")) && x.code === i.code)) issues.push(i);
  return { script, issues };
}

/** Issues from the reader and from the rules with the store's own name and language, once each. */
export function scriptIssues(raw: unknown, ctx: { storeName: string; storeLang: "ar" | "en" }): Issue[] {
  const { script, issues } = readScript(raw);
  if (!script) return [];
  // With the store's real name first: its lengths are the true ones (the reader counts the name as 1).
  const all = [...validateScript(script, ctx), ...issues];
  const seen = new Set<string>();
  return all.filter((i) => { const k = `${i.path.join(".")}|${i.code}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

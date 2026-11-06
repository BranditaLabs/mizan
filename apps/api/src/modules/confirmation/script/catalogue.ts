import { BUYER_CANCEL_REASONS, MAX_BUYER_REASONS } from "@mizan/shared";
import { z } from "zod";

/**
 * Every word the buyer reads in the chat after the template (M2, E6-16a), as keys the store can
 * rewrite. What stays fixed is composed in code: the Meta-approved template, the summary's
 * structure, the offer line's format, money, the reason list's shape and the IVR prompts.
 */
export const SCRIPT_KEYS = [
  "confirmed", "confirmed_offer_top",
  "change_prompt", "change_received",
  "cancel_prompt", "cancel_button", "cancel_header", "cancel_section", "keep_title", "keep_description", "cancelled",
  "offer_pitch", "offer_question", "btn_offer_yes", "btn_offer_no", "offer_added", "offer_added_generic", "offer_failed", "offer_failed_generic", "offer_declined", "offer_expired",
  "summary_pay", "summary_paid", "summary_more", "summary_area", "noted", "already",
  "opted_out", "opted_in", "on_delivery", "footer", "link_text",
  "call",
] as const;
export type ScriptKey = (typeof SCRIPT_KEYS)[number];

export const SCRIPT_GROUPS = ["confirmation", "change", "cancel", "offer", "summary", "system", "calls"] as const;
export type ScriptGroup = (typeof SCRIPT_GROUPS)[number];

export const PACKS = ["egyptian", "formal", "gulf"] as const;
export type Pack = (typeof PACKS)[number];

/** Never the address or phone. `order.city` is the one part of the address, kept since E6-5 as a deliberate minimum. */
export const VARIABLES = [
  "customer.first_name", "customer.greeting", "order.number", "order.total", "order.due", "order.cod", "order.items", "order.city", "store.name",
  "offer.title", "offer.line", "offer.new_total", "summary.due", "summary.more", "link", "start_keyword",
] as const;
export type Variable = (typeof VARIABLES)[number];

/** How long a variable is counted at validation; the store's name is counted at its real length when known. */
export const VAR_WIDTH: Record<Variable, number> = {
  "customer.first_name": 20, "customer.greeting": 30, "order.number": 16, "order.total": 20, "order.due": 20, "order.cod": 36, "order.items": 200, "order.city": 40,
  "store.name": 60, "offer.title": 60, "offer.line": 120, "offer.new_total": 20, "summary.due": 20, "summary.more": 3, link: 120, start_keyword: 8,
};

/**
 * text: a whole message; body: an interactive message's body; body_fragment: the top of one;
 * fragment: a line inside a message; button, list_button, row, section: titles; header, footer;
 * template_fragment: flows into the approved template's {{4}}; composed: code's lines unless the owner writes their own.
 */
export const KEY_KINDS = ["text", "body", "body_fragment", "fragment", "button", "list_button", "header", "section", "row", "row_description", "footer", "template_fragment", "composed"] as const;
export type KeyKind = (typeof KEY_KINDS)[number];

export interface KeySpec {
  group: ScriptGroup;
  kind: KeyKind;
  limit: number;
  vars: readonly Variable[];
  required: readonly Variable[];
  /** Empty leaves that part out of the message (the packs have no text for it). */
  optional: boolean;
  /** Null from the pack means code's built-in lines. */
  composed: boolean;
}

const STD = ["customer.first_name", "customer.greeting", "order.number", "order.total", "order.cod", "order.items", "order.city", "store.name"] as const satisfies readonly Variable[];
const spec = (group: ScriptGroup, kind: KeyKind, limit: number, vars: readonly Variable[] = [], extra: { required?: readonly Variable[]; optional?: boolean; composed?: boolean } = {}): KeySpec =>
  ({ group, kind, limit, vars, required: extra.required ?? [], optional: extra.optional ?? false, composed: extra.composed ?? false });

// Every text is at most 1000, so any of them also fits an interactive body (1024).
export const KEY_SPEC: Record<ScriptKey, KeySpec> = {
  confirmed: spec("confirmation", "text", 1000, STD),
  confirmed_offer_top: spec("confirmation", "body_fragment", 400, STD),
  change_prompt: spec("change", "text", 1000, STD),
  change_received: spec("change", "text", 1000, STD),
  cancel_prompt: spec("cancel", "body", 1000, STD),
  cancel_button: spec("cancel", "list_button", 20),
  cancel_header: spec("cancel", "header", 60, ["store.name", "order.number"], { optional: true }),
  cancel_section: spec("cancel", "section", 24, [], { optional: true }),
  keep_title: spec("cancel", "row", 24),
  keep_description: spec("cancel", "row_description", 72, [], { optional: true }),
  cancelled: spec("cancel", "text", 1000, STD),
  offer_pitch: spec("offer", "fragment", 300, ["offer.line", "offer.title"]),
  offer_question: spec("offer", "fragment", 200, ["offer.title"]),
  btn_offer_yes: spec("offer", "button", 20),
  btn_offer_no: spec("offer", "button", 20),
  offer_added: spec("offer", "text", 1000, [...STD, "offer.title", "offer.new_total"]),
  offer_added_generic: spec("offer", "text", 1000, STD),
  offer_failed: spec("offer", "text", 1000, [...STD, "offer.title"]),
  offer_failed_generic: spec("offer", "text", 1000, STD),
  offer_declined: spec("offer", "text", 1000, STD),
  offer_expired: spec("offer", "text", 1000, STD),
  summary_pay: spec("summary", "fragment", 80, ["summary.due"], { required: ["summary.due"] }),
  summary_paid: spec("summary", "fragment", 80),
  summary_more: spec("summary", "fragment", 80, ["summary.more"], { required: ["summary.more"] }),
  summary_area: spec("summary", "fragment", 80, ["order.city"], { required: ["order.city"] }),
  noted: spec("summary", "text", 1000, STD),
  already: spec("summary", "text", 1000, STD),
  opted_out: spec("system", "text", 1000, ["store.name", "customer.first_name", "start_keyword"], { required: ["start_keyword"] }),
  opted_in: spec("system", "text", 1000, ["store.name", "customer.first_name"]),
  on_delivery: spec("system", "template_fragment", 30),
  footer: spec("system", "footer", 60, ["store.name"], { optional: true }),
  link_text: spec("system", "text", 1000, [...STD, "order.due", "link"], { required: ["link"] }),
  call: spec("calls", "composed", 2000, STD, { composed: true }),
};

export const VARIABLE = /\{\{\s*([a-z_.]+)\s*\}\}/g;
/** The variable names a text uses, in order, each once. */
export const variablesIn = (text: string): string[] => [...new Set([...text.matchAll(VARIABLE)].map((m) => m[1]!))];
export const isVariable = (name: string): name is Variable => (VARIABLES as readonly string[]).includes(name);

const Text = z.string().trim().min(1).max(5000);
const Texts = z.strictObject(Object.fromEntries(SCRIPT_KEYS.map((k) => [k, Text.optional()])) as { [K in ScriptKey]: z.ZodOptional<typeof Text> });

/** One of the store's cancel reasons: its own words, mapped onto a canonical code. */
export const ReasonItemSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9_]{1,32}$/).describe("Stable slug; no '-' (it separates the signed argument)"),
  code: z.enum(BUYER_CANCEL_REASONS).describe("The canonical code reports and events use"),
  title: z.object({ ar: z.string().trim().min(1).max(24).optional(), en: z.string().trim().min(1).max(24).optional() }),
  description: z.object({ ar: z.string().trim().max(72).optional(), en: z.string().trim().max(72).optional() }).optional(),
});
export type ReasonItem = z.output<typeof ReasonItemSchema>;

/** The shape only (a preview takes a draft with problems and answers them as issues). */
export const ScriptDraftSchema = z.strictObject({
  version: z.literal(2).optional().describe("2 since E6-16a; absent on scripts saved before"),
  pack: z.enum(PACKS).describe("The starting wording: egyptian (default), formal Arabic or gulf"),
  texts: z.strictObject({ ar: Texts, en: Texts }).describe("The owner's own wording per key and language; absent = the pack's"),
  cancelReasons: z.array(ReasonItemSchema).min(1).max(MAX_BUYER_REASONS).optional().describe("The store's cancel reasons; absent = the pack's five"),
});
export type Script = z.output<typeof ScriptDraftSchema>;
export const DEFAULT_SCRIPT: Script = { pack: "egyptian", texts: { ar: {}, en: {} } };

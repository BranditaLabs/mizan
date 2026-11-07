import { createHash } from "node:crypto";
import { BUYER_CANCEL_REASONS, MAX_BUYER_REASONS } from "@mizan/shared";
import { TEMPLATE_TEXT } from "../messages.js";
import { TEMPLATE_SPECS, TEMPLATE_VARIANTS } from "../templates.js";
import { KEY_SPEC, PACKS, SCRIPT_GROUPS, SCRIPT_KEYS, VAR_WIDTH, VARIABLES } from "./catalogue.js";
import { PACK_REASONS, PACK_TEXTS } from "./packs.js";

let built: { body: ReturnType<typeof build>; etag: string } | undefined;

function build() {
  return {
    packs: [...PACKS],
    groups: [...SCRIPT_GROUPS],
    keys: SCRIPT_KEYS.map((key) => ({ key, ...KEY_SPEC[key], vars: [...KEY_SPEC[key].vars], required: [...KEY_SPEC[key].required] })),
    variables: VARIABLES.map((name) => ({ name, width: VAR_WIDTH[name] })),
    cancelCodes: [...BUYER_CANCEL_REASONS],
    maxReasons: MAX_BUYER_REASONS,
    packTexts: Object.fromEntries(PACKS.map((p) => [p, { ar: { ...PACK_TEXTS[p].ar }, en: { ...PACK_TEXTS[p].en } }])) as Record<(typeof PACKS)[number], { ar: Record<string, string>; en: Record<string, string> }>,
    packReasons: PACK_REASONS,
    // Deprecated (E6-16d): the store-independent defaults; `templates` has every variant.
    templateText: { ar: { body: TEMPLATE_TEXT.ar.body, buttons: [...TEMPLATE_TEXT.ar.buttons] }, en: { body: TEMPLATE_TEXT.en.body, buttons: [...TEMPLATE_TEXT.en.buttons] } },
    templates: TEMPLATE_VARIANTS.map((v) => { const s = TEMPLATE_SPECS[v]; return { variant: v, name: s.name, lang: s.lang, body: s.body, buttons: [...s.buttons] }; }),
  };
}

/** The editor's catalogue (E6-16a): the same for every store until the next deploy, so its ETag is a hash of it. */
export function scriptCatalogue() {
  if (!built) {
    const body = build();
    built = { body, etag: `"${createHash("sha256").update(JSON.stringify(body)).digest("base64url").slice(0, 27)}"` };
  }
  return built;
}

/**
 * Mizan lint rule (docs/16 §4 B1): every `useTranslations("ns")` and `getTranslations("ns" | { namespace })`
 * names a namespace that exists in messages/{ar,en}.json (plus "landing" from messages/landing/*.json).
 * A wrong namespace ("problem" for "problems") renders raw keys in production; next-intl only warns at runtime.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => JSON.parse(readFileSync(join(here, "..", "messages", p), "utf8"));

/** Both locales, with the landing files mounted under "landing" as src/i18n/request.ts does. */
export function loadMessages() {
  return ["ar", "en"].map((l) => ({ ...read(`${l}.json`), landing: read(`landing/${l}.json`) }));
}
let cached;

/** True when `ns` ("a.b.c") is an object in every message tree. */
export function namespaceExists(ns, trees = (cached ??= loadMessages())) {
  return trees.every((tree) => {
    let node = tree;
    for (const part of ns.split(".")) {
      if (node === null || typeof node !== "object" || !(part in node)) return false;
      node = node[part];
    }
    return node !== null && typeof node === "object";
  });
}

const CALLEES = new Set(["useTranslations", "getTranslations"]);

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: { description: "Translation namespaces must exist in messages/{ar,en}.json" },
    messages: { unknown: "Namespace '{{ns}}' is not in messages/ar.json and messages/en.json; the screen would show raw keys." },
    schema: [],
  },
  create(context) {
    const exists = (ns) => namespaceExists(ns);
    const literal = (node) => (node?.type === "Literal" && typeof node.value === "string" ? node : null);
    return {
      CallExpression(node) {
        if (node.callee.type !== "Identifier" || !CALLEES.has(node.callee.name)) return;
        const arg = node.arguments[0];
        let lit = literal(arg);
        if (!lit && arg?.type === "ObjectExpression") {
          const prop = arg.properties.find((p) => p.type === "Property" && !p.computed && (p.key.name ?? p.key.value) === "namespace");
          lit = literal(prop?.value);
        }
        if (lit && !exists(lit.value)) context.report({ node: lit, messageId: "unknown", data: { ns: lit.value } });
      },
    };
  },
};

export default rule;

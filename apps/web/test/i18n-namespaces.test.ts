import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { RuleTester } from "eslint";
import { describe, expect, it } from "vitest";
import rule, { namespaceExists } from "../eslint-rules/no-unknown-i18n-namespace.js";

RuleTester.describe = describe;
RuleTester.it = it;
const tester = new RuleTester({ languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } } });

tester.run("no-unknown-i18n-namespace", rule, {
  valid: [
    `useTranslations("problems")`,
    `useTranslations("problems.load.network")`,
    `getTranslations({ locale, namespace: "orders" })`,
    `getTranslations({ locale, namespace: "landing.meta" })`,
    `useTranslations()`,
    `useTranslations(ns)`,
  ],
  invalid: [
    { code: `useTranslations("problem")`, errors: [{ messageId: "unknown", data: { ns: "problem" } }] },
    { code: `getTranslations({ locale, namespace: "nope.nothing" })`, errors: 1 },
    { code: `getTranslations("problems.network")`, errors: 1 }, // a string key, not a namespace
  ],
});

/** Every file under src: the literal namespaces it asks for (docs/16 §4 B1). */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : /\.(tsx?|mjs)$/.test(f) ? [p] : [];
  });
}

describe("translation namespaces exist (B1)", () => {
  it("every useTranslations / getTranslations namespace in src is in both message files", () => {
    const missing: string[] = [];
    for (const file of sources(join(__dirname, "..", "src"))) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/(?:useTranslations|getTranslations)\(\s*(?:\{[^}]*namespace:\s*)?"([\w.]+)"/g)) {
        if (!namespaceExists(m[1]!)) missing.push(`${file}: ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("the shared error namespace is 'problems' (the old 'problem' never existed)", () => {
    expect(namespaceExists("problems")).toBe(true);
    expect(namespaceExists("problem")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import ar from "../messages/landing/ar.json";
import en from "../messages/landing/en.json";
import mainAr from "../messages/ar.json";

/** The public landing page's copy (namespace "landing", merged in src/i18n/request.ts): the same rules as messages.test.ts. */
type Tree = { [k: string]: string | Tree };
const flatten = (t: Tree, prefix = ""): Record<string, string> =>
  Object.fromEntries(Object.entries(t).flatMap(([k, v]) => (typeof v === "string" ? [[prefix + k, v]] : Object.entries(flatten(v, `${prefix}${k}.`)))));
const args = (s: string) => [...new Set([...s.matchAll(/(?<!(?:zero|one|two|few|many|other|=\d+)\s*)\{(\w+)\s*[,}]/g)].map((m) => m[1]))].sort();
const tags = (s: string) => [...s.matchAll(/<(\w+)>/g)].map((m) => m[1]).sort();

describe("landing messages (CLAUDE.md rule 11: Arabic and English are equal)", () => {
  const A = flatten(ar as Tree);
  const E = flatten(en as Tree);

  it("have the same keys in both languages", () => {
    expect(Object.keys(A).sort()).toEqual(Object.keys(E).sort());
  });

  it("use the same arguments and tags in both languages, and no empty strings", () => {
    for (const k of Object.keys(A)) {
      expect(args(A[k]!), k).toEqual(args(E[k]!));
      expect(tags(A[k]!), k).toEqual(tags(E[k]!));
      expect(A[k]!.trim(), k).not.toBe("");
      expect(E[k]!.trim(), k).not.toBe("");
    }
  });

  it("Arabic copy uses Western digits", () => {
    for (const [k, v] of Object.entries(A)) expect(/[٠-٩]/.test(v), `${k}: ${v}`).toBe(false);
  });

  it("Arabic copy is actually Arabic (no untranslated English left behind)", () => {
    // The language button shows the other language's own name.
    const allowedLatin = new Set(["nav.lang"]);
    for (const [k, v] of Object.entries(A)) {
      if (allowedLatin.has(k)) continue;
      expect(/[؀-ۿ]/.test(v), `${k}: ${v}`).toBe(true);
    }
  });

  it("the WhatsApp conversation is Arabic on both pages (it shows the Arabic customers get)", () => {
    for (const [k, v] of Object.entries(E)) if (k.startsWith("arabic.chat.")) expect(v, k).toBe(A[k]);
  });

  it("does not collide with a namespace of the main messages", () => {
    expect(Object.keys(mainAr)).not.toContain("landing");
  });
});

import { describe, expect, it } from "vitest";
import ar from "../messages/ar.json";
import en from "../messages/en.json";

type Tree = { [k: string]: string | Tree };
const flatten = (t: Tree, prefix = ""): Record<string, string> =>
  Object.fromEntries(Object.entries(t).flatMap(([k, v]) => (typeof v === "string" ? [[prefix + k, v]] : Object.entries(flatten(v, `${prefix}${k}.`)))));
const args = (s: string) => [...s.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();
const tags = (s: string) => [...s.matchAll(/<(\w+)>/g)].map((m) => m[1]).sort();

describe("messages (CLAUDE.md rule 11: Arabic and English are equal)", () => {
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

  it("Arabic copy is actually Arabic (no untranslated English left behind)", () => {
    const allowedLatin = new Set(["shell.language.en"]);
    for (const [k, v] of Object.entries(A)) {
      if (allowedLatin.has(k)) continue;
      expect(/[؀-ۿ]/.test(v), `${k}: ${v}`).toBe(true);
    }
  });
});

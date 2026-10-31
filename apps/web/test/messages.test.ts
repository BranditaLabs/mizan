import { describe, expect, it } from "vitest";
import ar from "../messages/ar.json";
import en from "../messages/en.json";

type Tree = { [k: string]: string | Tree };
const flatten = (t: Tree, prefix = ""): Record<string, string> =>
  Object.fromEntries(Object.entries(t).flatMap(([k, v]) => (typeof v === "string" ? [[prefix + k, v]] : Object.entries(flatten(v, `${prefix}${k}.`)))));
// ICU arguments ({store}, {count, plural, …}), not plural branches ("one {# order}", "other {Orders}").
const args = (s: string) => [...new Set([...s.matchAll(/(?<!(?:zero|one|two|few|many|other|=\d+)\s*)\{(\w+)\s*[,}]/g)].map((m) => m[1]))].sort();
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

  it("reads ICU arguments, not plural branches", () => {
    expect(args("{count, plural, one {Ship # order} other {Orders}}")).toEqual(["count"]);
    expect(args("Order #{id} for {store}")).toEqual(["id", "store"]);
  });

  it("Arabic copy uses Western digits (docs/08 §3: Eastern digits are a store setting, applied when formatting)", () => {
    for (const [k, v] of Object.entries(A)) expect(/[٠-٩]/.test(v), `${k}: ${v}`).toBe(false);
  });

  it("Arabic copy is actually Arabic (no untranslated English left behind)", () => {
    // The English name of English, and example data shown as is (an email address, a phone number, an order id).
    const allowedLatin = new Set(["shell.language.en", "auth.emailPlaceholder", "auth.phonePlaceholder", "auth.brand.orderId"]);
    for (const [k, v] of Object.entries(A)) {
      if (allowedLatin.has(k)) continue;
      expect(/[؀-ۿ]/.test(v), `${k}: ${v}`).toBe(true);
    }
  });
});

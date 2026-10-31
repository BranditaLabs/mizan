import { readdirSync, readFileSync } from "node:fs";
import { LEGAL_DOCUMENTS } from "@mizan/shared";
import { describe, expect, it } from "vitest";
import { routing } from "../src/i18n/routing";
import { isLegalDocument, LEGAL_FILES, legalPath } from "../src/lib/legal";

/**
 * L1-3: the legal pages show copies of docs/legal (the source of truth). A change made on one side
 * only fails here: edit docs/legal, then copy (cp docs/legal/*.{ar,en}.md apps/web/content/legal/).
 */
const docs = new URL("../../../docs/legal/", import.meta.url);
const content = new URL("../content/legal/", import.meta.url);

describe("legal pages", () => {
  it("every document has its text in both languages, equal to docs/legal", () => {
    for (const doc of LEGAL_DOCUMENTS) {
      for (const locale of routing.locales) {
        const file = `${LEGAL_FILES[doc]}.${locale}.md`;
        const copy = readFileSync(new URL(file, content), "utf8");
        expect(copy.length, file).toBeGreaterThan(500);
        expect(copy, `apps/web/content/legal/${file} differs from docs/legal/${file}`).toBe(readFileSync(new URL(file, docs), "utf8"));
      }
    }
  });

  it("holds only the documents the pages show", () => {
    const expected = LEGAL_DOCUMENTS.flatMap((d) => routing.locales.map((l) => `${LEGAL_FILES[d]}.${l}.md`)).sort();
    expect(readdirSync(content).sort()).toEqual(expected);
  });

  it("the Arabic text is Arabic and the English is English", () => {
    for (const doc of LEGAL_DOCUMENTS) {
      expect(readFileSync(new URL(`${LEGAL_FILES[doc]}.ar.md`, content), "utf8").match(/[؀-ۿ]/g)?.length ?? 0).toBeGreaterThan(500);
      expect(readFileSync(new URL(`${LEGAL_FILES[doc]}.en.md`, content), "utf8")).not.toMatch(/[؀-ۿ]/);
    }
  });

  it("names the pages by document", () => {
    expect(LEGAL_DOCUMENTS.map(legalPath)).toEqual(["/legal/terms", "/legal/privacy", "/legal/dpa"]);
    expect(isLegalDocument("dpa")).toBe(true);
    expect(isLegalDocument("cookies")).toBe(false);
  });
});

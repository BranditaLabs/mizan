import { describe, expect, it } from "vitest";
import {
  ACCEPTED_DOCUMENTS, isAcceptedDocument, isCurrentLegal, LEGAL_DOCUMENTS, LEGAL_STATUS, LEGAL_VERSIONS, needsLegalAcceptance,
} from "../src/legal.js";

describe("legal", () => {
  it("versions every document as major.minor; owners accept the terms and the DPA, not the privacy notice", () => {
    for (const d of LEGAL_DOCUMENTS) expect(LEGAL_VERSIONS[d]).toMatch(/^[0-9]+\.[0-9]+$/);
    expect([...ACCEPTED_DOCUMENTS]).toEqual(["terms", "dpa"]);
    expect(isAcceptedDocument("dpa")).toBe(true);
    expect(isAcceptedDocument("privacy")).toBe(false);
  });

  it("stays a draft until counsel approves", () => {
    expect(LEGAL_STATUS).toBe("draft");
  });

  it("publishes only approved versions (1.0+), so draft-era acceptances (0.x) never count as accepting the published texts", () => {
    const status: string = LEGAL_STATUS;
    const drafts = LEGAL_DOCUMENTS.filter((d) => LEGAL_VERSIONS[d].startsWith("0."));
    if (status === "published") expect(drafts, "bump LEGAL_VERSIONS to 1.0 when flipping LEGAL_STATUS").toEqual([]);
    else expect(drafts).toEqual([...LEGAL_DOCUMENTS]);
  });

  it("checks that accepted versions are the current ones", () => {
    expect(isCurrentLegal({ terms: LEGAL_VERSIONS.terms, dpa: LEGAL_VERSIONS.dpa })).toBe(true);
    expect(isCurrentLegal({ terms: LEGAL_VERSIONS.terms })).toBe(false);
    expect(isCurrentLegal({ terms: "0.0", dpa: LEGAL_VERSIONS.dpa })).toBe(false);
  });

  it("asks for acceptance only when published and a current version is missing", () => {
    const all = ACCEPTED_DOCUMENTS.map((document) => ({ document, version: LEGAL_VERSIONS[document] }));
    expect(needsLegalAcceptance("draft", [])).toBe(false);
    expect(needsLegalAcceptance("published", [])).toBe(true);
    expect(needsLegalAcceptance("published", all)).toBe(false);
    expect(needsLegalAcceptance("published", [all[0]!, { document: "dpa", version: "0.0" }])).toBe(true);
  });
});

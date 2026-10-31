import { describe, expect, it } from "vitest";
import { ApiError } from "../src/lib/api/client";
import { isLegalVersionChanged, legalView, showLegalBanner, type LegalCheck } from "../src/lib/legal";

/** L1-3: who sees the owner's "Accept and continue" page, a loader, or the team's banner. */
const needs: LegalCheck = { needsAcceptance: true, pending: false, error: false };
const accepted: LegalCheck = { needsAcceptance: false, pending: false, error: false };
const pending: LegalCheck = { pending: true, error: false };
const failed: LegalCheck = { pending: true, error: true };

describe("legal gate", () => {
  it("stops only the owner of a store that must accept", () => {
    expect(legalView("owner", needs, true)).toBe("gate");
    expect(legalView("owner", accepted, true)).toBe("store");
    for (const role of ["admin", "agent", "warehouse", undefined]) expect(legalView(role, needs, true)).toBe("store");
  });

  it("never stops anyone while the documents are drafts (the API never says needsAcceptance then)", () => {
    expect(legalView("owner", { needsAcceptance: false, pending: false, error: false }, false)).toBe("store");
    expect(legalView("owner", pending, false)).toBe("store"); // no loader for drafts either
  });

  it("holds the owner on a loader while the check runs once published, so the store never flashes open", () => {
    expect(legalView("owner", pending, true)).toBe("loading");
    expect(legalView("agent", pending, true)).toBe("store");
  });

  it("opens the store when the check fails (the API holds the record)", () => {
    expect(legalView("owner", failed, true)).toBe("store");
  });

  it("shows the team's banner to everyone but the owner, only while acceptance is missing", () => {
    expect(showLegalBanner("agent", needs)).toBe(true);
    expect(showLegalBanner("admin", needs)).toBe(true);
    expect(showLegalBanner("owner", needs)).toBe(false);
    expect(showLegalBanner("agent", accepted)).toBe(false);
    expect(showLegalBanner("agent", pending)).toBe(false);
    expect(showLegalBanner(undefined, needs)).toBe(false);
  });

  it("tells a 409 legal_version_changed (reload and read again) apart from other failures", () => {
    expect(isLegalVersionChanged(new ApiError(409, "legal_version_changed", ""))).toBe(true);
    expect(isLegalVersionChanged(new ApiError(409, "slug_taken", ""))).toBe(false);
    expect(isLegalVersionChanged(new Error("network"))).toBe(false);
    expect(isLegalVersionChanged(null)).toBe(false);
  });
});

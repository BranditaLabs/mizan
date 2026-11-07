import { describe, expect, it } from "vitest";
import { safeNext } from "../src/lib/next-path";

describe("safeNext: after the staff sign-in, only a path inside the back office (AU-1, S1)", () => {
  it("keeps a path in this app, with its query", () => {
    expect(safeNext("/stores")).toBe("/stores");
    expect(safeNext("/stores?q=nile")).toBe("/stores?q=nile");
    expect(safeNext(null)).toBe("/");
    expect(safeNext("")).toBe("/");
  });

  it("never another site: protocol-relative, backslashes, control characters, also percent-encoded", () => {
    for (const bad of ["//evil.com", "/\\evil.com", "https://evil.com", "evil.com", "/\t/evil.com", "/\n/evil.com", "/\u0085x", "/%5Cevil.com", "/%2F/evil.com", "/%09/evil.com", "/%E0%A4%A"]) {
      expect(safeNext(bad), bad).toBe("/");
    }
  });
});

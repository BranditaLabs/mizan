import { describe, expect, it } from "vitest";
import { authErrorKey } from "../src/lib/auth-errors";
import { safeNext } from "../src/lib/next-path";

describe("safeNext: after sign-in, only a path inside this app", () => {
  it("keeps app paths", () => {
    expect(safeNext("/")).toBe("/");
    expect(safeNext("/orders?status=new")).toBe("/orders?status=new");
    expect(safeNext(["/welcome", "/x"])).toBe("/welcome");
  });
  it("refuses other origins and odd values", () => {
    for (const bad of ["//evil.example/x", "/\\evil.example", "https://evil.example", "javascript:alert(1)", "", undefined]) expect(safeNext(bad), String(bad)).toBe("/");
  });
});

describe("authErrorKey: Firebase codes → our messages", () => {
  it("maps the codes people actually hit", () => {
    expect(authErrorKey({ code: "auth/invalid-credential" })).toBe("invalidCredential");
    expect(authErrorKey({ code: "auth/wrong-password" })).toBe("invalidCredential");
    expect(authErrorKey({ code: "auth/email-already-in-use" })).toBe("emailInUse");
    expect(authErrorKey({ code: "auth/invalid-verification-code" })).toBe("invalidCode");
    expect(authErrorKey({ code: "auth/too-many-requests" })).toBe("tooMany");
    expect(authErrorKey({ code: "auth/network-request-failed" })).toBe("network");
  });
  it("never shows Firebase's own text: anything else is generic", () => {
    expect(authErrorKey({ code: "auth/something-new" })).toBe("generic");
    expect(authErrorKey(new Error("boom"))).toBe("generic");
    expect(authErrorKey(null)).toBe("generic");
  });
});

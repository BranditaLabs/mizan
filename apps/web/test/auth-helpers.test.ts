import { describe, expect, it } from "vitest";
import { ApiError } from "../src/lib/api/client";
import { authErrorKey, authErrorPlace, isInAppBrowser, SILENT, type AuthErrorKey } from "../src/lib/auth-errors";
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

describe("every Firebase and API code in the spec's table (§7.4) has its message and place", () => {
  const TABLE: Array<[string, AuthErrorKey]> = [
    ["auth/invalid-login-credentials", "invalidCredential"], ["auth/user-not-found", "invalidCredential"],
    ["auth/credential-already-in-use", "emailInUse"], ["auth/provider-already-linked", "emailInUse"],
    ["auth/weak-password", "weakPassword"], ["auth/password-does-not-meet-requirements", "weakPassword"],
    ["auth/invalid-email", "invalidEmail"], ["auth/missing-email", "requiredEmail"], ["auth/missing-password", "requiredPassword"],
    ["auth/missing-phone-number", "requiredPhone"], ["auth/invalid-phone-number", "invalidPhone"],
    ["auth/missing-verification-code", "invalidCode"], ["auth/code-expired", "codeExpired"], ["auth/invalid-verification-id", "codeExpired"],
    ["auth/session-expired", "codeExpired"], ["auth/invalid-multi-factor-session", "mfaTimedOut"], ["auth/missing-multi-factor-session", "mfaTimedOut"],
    ["auth/multi-factor-info-not-found", "mfaTimedOut"], ["auth/quota-exceeded", "smsQuota"], ["auth/captcha-check-failed", "captchaFailed"],
    ["auth/invalid-app-credential", "captchaFailed"], ["auth/missing-app-credential", "captchaFailed"], ["auth/timeout", "network"],
    ["auth/popup-blocked", "popupBlocked"], ["auth/operation-not-allowed", "methodOff"], ["auth/admin-restricted-operation", "methodOff"],
    ["auth/account-exists-with-different-credential", "otherMethod"], ["auth/user-disabled", "userDisabled"],
    ["auth/requires-recent-login", "recentLogin"], ["auth/unverified-email", "verifyFirst"], ["auth/second-factor-already-in-use", "phoneInUse"],
    ["auth/maximum-second-factor-count-exceeded", "factorMax"], ["auth/unsupported-first-factor", "mfaNoPhone"],
    ["auth/web-storage-unsupported", "storageBlocked"], ["auth/operation-not-supported-in-this-environment", "storageBlocked"],
    ["auth/expired-action-code", "linkExpired"], ["auth/invalid-action-code", "linkExpired"], ["auth/internal-error", "generic"], ["auth/unauthorized-domain", "generic"],
  ];
  it.each(TABLE)("%s → %s", (code, key) => expect(authErrorKey({ code })).toBe(key));

  it("API errors: SSO, 429 with and without a wait, no connection", () => {
    expect(authErrorKey(new ApiError(404, "sso_not_configured", "x"))).toBe("ssoNotSet");
    expect(authErrorKey(new ApiError(400, "sso_domain_mismatch", "x"))).toBe("ssoWrongDomain");
    expect(authErrorKey(new ApiError(429, "rate_limited", "x", "Try again in 42 seconds"))).toBe("tooManyWait");
    expect(authErrorKey(new ApiError(429, "rate_limited", "x"))).toBe("tooMany");
    expect(authErrorKey(new ApiError(0, "network", "x"))).toBe("network");
  });
  it("closed windows are silent", () => {
    for (const c of ["auth/popup-closed-by-user", "auth/cancelled-popup-request", "auth/user-cancelled"]) expect(SILENT.has(c)).toBe(true);
  });
  it("field-bound messages go to their field; credential and code refusals stay the form's alert", () => {
    expect(authErrorPlace("invalidEmail")).toEqual({ field: "email" });
    expect(authErrorPlace("emailInUse")).toEqual({ field: "email" });
    expect(authErrorPlace("weakPassword")).toEqual({ field: "password" });
    expect(authErrorPlace("invalidPhone")).toEqual({ field: "phone" });
    expect(authErrorPlace("phoneInUse")).toEqual({ field: "phone" });
    expect(authErrorPlace("codeIncomplete")).toEqual({ field: "code" });
    expect(authErrorPlace("invalidCredential")).toBe("form");
    expect(authErrorPlace("invalidCode")).toBe("form");
  });
  it("in-app browsers are recognised", () => {
    expect(isInAppBrowser("Mozilla/5.0 (iPhone) [FBAN/FBIOS;FBAV/450]")).toBe(true);
    expect(isInAppBrowser("Mozilla/5.0 (Linux; Android 14; wv) Instagram 300")).toBe(true);
    expect(isInAppBrowser("Mozilla/5.0 (Windows NT 10.0) Chrome/130")).toBe(false);
  });
});

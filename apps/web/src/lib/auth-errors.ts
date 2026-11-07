import { ApiError } from "@/lib/api/client";

/**
 * Firebase Auth error codes (and the API's, before sign-in) → `auth.errors.*` messages: never
 * Firebase's English text. Unknown codes are `generic`; only the code is ever logged, never PII.
 * `authErrorPlace` says where a message goes: under one field (focus moves there), as the form's
 * alert, or nowhere (a closed popup).
 */
export type AuthErrorKey =
  | "invalidCredential" | "emailInUse" | "weakPassword" | "passwordShort" | "invalidEmail" | "requiredEmail" | "requiredPassword"
  | "requiredPhone" | "invalidPhone" | "invalidCode" | "codeIncomplete" | "codeExpired" | "mfaTimedOut" | "tooMany" | "tooManyWait"
  | "smsQuota" | "captchaFailed" | "network" | "popupBlocked" | "methodOff" | "otherMethod" | "userDisabled" | "recentLogin"
  | "verifyFirst" | "phoneInUse" | "factorMax" | "mfaNoPhone" | "storageBlocked" | "inAppBrowser" | "linkExpired"
  | "ssoNotSet" | "ssoWrongDomain" | "generic";

const BY_CODE: Record<string, AuthErrorKey> = {
  "auth/invalid-credential": "invalidCredential",
  "auth/invalid-login-credentials": "invalidCredential",
  "auth/wrong-password": "invalidCredential",
  "auth/user-not-found": "invalidCredential",
  "auth/email-already-in-use": "emailInUse",
  "auth/credential-already-in-use": "emailInUse",
  "auth/provider-already-linked": "emailInUse",
  "auth/weak-password": "weakPassword",
  "auth/password-does-not-meet-requirements": "weakPassword",
  "auth/invalid-email": "invalidEmail",
  "auth/missing-email": "requiredEmail",
  "auth/missing-password": "requiredPassword",
  "auth/invalid-phone-number": "invalidPhone",
  "auth/missing-phone-number": "requiredPhone",
  "auth/invalid-verification-code": "invalidCode",
  "auth/missing-verification-code": "invalidCode",
  "auth/code-expired": "codeExpired",
  "auth/invalid-verification-id": "codeExpired",
  "auth/session-expired": "codeExpired",
  "auth/invalid-multi-factor-session": "mfaTimedOut",
  "auth/missing-multi-factor-session": "mfaTimedOut",
  "auth/multi-factor-info-not-found": "mfaTimedOut",
  "auth/too-many-requests": "tooMany",
  "auth/quota-exceeded": "smsQuota",
  "auth/captcha-check-failed": "captchaFailed",
  "auth/invalid-app-credential": "captchaFailed",
  "auth/missing-app-credential": "captchaFailed",
  "auth/network-request-failed": "network",
  "auth/timeout": "network",
  "auth/popup-blocked": "popupBlocked",
  "auth/operation-not-allowed": "methodOff",
  "auth/admin-restricted-operation": "methodOff",
  "auth/account-exists-with-different-credential": "otherMethod",
  "auth/user-disabled": "userDisabled",
  "auth/requires-recent-login": "recentLogin",
  "auth/unverified-email": "verifyFirst",
  "auth/second-factor-already-in-use": "phoneInUse",
  "auth/maximum-second-factor-count-exceeded": "factorMax",
  "auth/unsupported-first-factor": "mfaNoPhone",
  "auth/web-storage-unsupported": "storageBlocked",
  "auth/operation-not-supported-in-this-environment": "storageBlocked",
  "auth/expired-action-code": "linkExpired",
  "auth/invalid-action-code": "linkExpired",
};

/** The person closed the Google or company window: nothing to say. */
export const SILENT = new Set(["auth/popup-closed-by-user", "auth/cancelled-popup-request", "auth/user-cancelled"]);

export function authErrorKey(e: unknown): AuthErrorKey {
  if (e instanceof ApiError) {
    if (e.code === "sso_not_configured") return "ssoNotSet";
    if (e.code === "sso_domain_mismatch") return "ssoWrongDomain";
    if (e.status === 429) return retryAfterOf(e) ? "tooManyWait" : "tooMany";
    if (e.status === 0) return "network";
    return "generic";
  }
  return BY_CODE[authErrorCode(e)] ?? "generic";
}

export function authErrorCode(e: unknown): string {
  return typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : "";
}

export type AuthField = "email" | "password" | "phone" | "code";
export type AuthErrorPlace = { field: AuthField } | "form" | "silent";

/** Field-bound codes attach to their field; credential and code refusals stay as the form's alert. */
export function authErrorPlace(key: AuthErrorKey): AuthErrorPlace {
  switch (key) {
    case "invalidEmail": case "requiredEmail": case "emailInUse": return { field: "email" };
    case "weakPassword": case "passwordShort": case "requiredPassword": return { field: "password" };
    case "invalidPhone": case "requiredPhone": case "phoneInUse": return { field: "phone" };
    case "codeIncomplete": return { field: "code" };
    default: return "form";
  }
}

/** Seconds the API asked us to wait (429 with Retry-After, carried in the problem's detail or errors). */
export function retryAfterOf(e: unknown): number | null {
  if (!(e instanceof ApiError)) return null;
  const n = Number(/(\d+)/.exec(e.detail ?? "")?.[1]);
  return Number.isFinite(n) && n > 0 && n < 3600 ? n : null;
}

/** Google's sign-in window does not open inside these apps' browsers (Facebook, Instagram, TikTok …). */
export function isInAppBrowser(ua: string): boolean {
  return /FBAN|FBAV|Instagram|Line\/|TikTok|Snapchat|; wv\)/.test(ua);
}

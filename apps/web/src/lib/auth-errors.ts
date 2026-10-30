/** Firebase Auth error codes → `auth.errors.*` messages (never Firebase's English text). */
export type AuthErrorKey =
  | "invalidCredential" | "emailInUse" | "weakPassword" | "invalidEmail" | "invalidPhone"
  | "invalidCode" | "codeExpired" | "tooMany" | "network" | "popupBlocked" | "methodOff" | "otherMethod" | "generic";

const BY_CODE: Record<string, AuthErrorKey> = {
  "auth/invalid-credential": "invalidCredential",
  "auth/invalid-login-credentials": "invalidCredential",
  "auth/wrong-password": "invalidCredential",
  "auth/user-not-found": "invalidCredential",
  "auth/email-already-in-use": "emailInUse",
  "auth/weak-password": "weakPassword",
  "auth/password-does-not-meet-requirements": "weakPassword",
  "auth/invalid-email": "invalidEmail",
  "auth/missing-email": "invalidEmail",
  "auth/invalid-phone-number": "invalidPhone",
  "auth/missing-phone-number": "invalidPhone",
  "auth/invalid-verification-code": "invalidCode",
  "auth/missing-verification-code": "invalidCode",
  "auth/code-expired": "codeExpired",
  "auth/session-expired": "codeExpired",
  "auth/too-many-requests": "tooMany",
  "auth/quota-exceeded": "tooMany",
  "auth/network-request-failed": "network",
  "auth/popup-blocked": "popupBlocked",
  "auth/operation-not-allowed": "methodOff",
  "auth/account-exists-with-different-credential": "otherMethod",
};

export function authErrorKey(e: unknown): AuthErrorKey {
  const code = typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : "";
  return BY_CODE[code] ?? "generic";
}

export function authErrorCode(e: unknown): string {
  return typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : "";
}

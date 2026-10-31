import { createRemoteJWKSet, errors as joseErrors, jwtVerify, UnsecuredJWT, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { ProblemError } from "../http/problem.js";

/** Who the bearer token says the caller is. Authorization (tenants, roles) lives in Postgres (ADR-0010). */
export interface VerifiedIdentity {
  /** Firebase uid. */
  uid: string;
  email?: string;
  emailVerified: boolean;
  /** E.164, from phone sign-in. */
  phone?: string;
  name?: string;
  signInProvider?: string;
  /** Set when the session was established with a second factor (TOTP, SMS). */
  secondFactor?: string;
}

export interface TokenVerifier {
  /** Resolve a bearer token to an identity, or throw a 401 ProblemError. */
  verify(token: string): Promise<VerifiedIdentity>;
}

export const TOKEN_VERIFIER = Symbol("TOKEN_VERIFIER");

/** Google's public keys for Firebase ID tokens (rotated by Google; jose caches and refetches). */
export const FIREBASE_JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

const CLOCK_TOLERANCE_S = 5;

/**
 * Verifies Firebase ID tokens locally: RS256 signature against Google's keys,
 * issuer, audience (project id), expiry, auth_time and subject, as Firebase
 * documents for third-party JWT libraries.
 *
 * Not covered here: revocation (`revokeRefreshTokens`). ID tokens live one hour;
 * disabling a member in Mizan takes effect on the next request regardless.
 */
export class FirebaseTokenVerifier implements TokenVerifier {
  private readonly keys: JWTVerifyGetKey;

  constructor(private readonly projectId: string, keys?: JWTVerifyGetKey) {
    this.keys = keys ?? createRemoteJWKSet(new URL(FIREBASE_JWKS_URL), { cooldownDuration: 30_000, cacheMaxAge: 6 * 3600_000 });
  }

  async verify(token: string): Promise<VerifiedIdentity> {
    let payload;
    try {
      ({ payload } = await jwtVerify(token, this.keys, {
        issuer: `https://securetoken.google.com/${this.projectId}`,
        audience: this.projectId,
        algorithms: ["RS256"],
        clockTolerance: CLOCK_TOLERANCE_S,
        requiredClaims: ["sub", "iat", "exp", "auth_time"],
      }));
    } catch (err) {
      if (err instanceof joseErrors.JWTExpired) throw new ProblemError(401, "token_expired", "the sign-in token has expired");
      throw new ProblemError(401, "token_invalid", "the sign-in token is not valid");
    }
    return identityFrom(payload);
  }
}

/** Claims every Firebase ID token must carry, checked after the signature (or, in the emulator, instead of it). */
function identityFrom(payload: JWTPayload): VerifiedIdentity {
  const sub = payload.sub ?? "";
  const authTime = payload.auth_time;
  if (!sub || sub.length > 128) throw new ProblemError(401, "token_invalid", "the sign-in token has no subject");
  if (typeof authTime !== "number" || authTime > Date.now() / 1000 + CLOCK_TOLERANCE_S) {
    throw new ProblemError(401, "token_invalid", "the sign-in token has an invalid auth_time");
  }
  const firebase = (payload.firebase ?? {}) as { sign_in_provider?: unknown; sign_in_second_factor?: unknown };
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  return {
    uid: sub,
    email: str(payload.email),
    emailVerified: payload.email_verified === true,
    phone: str(payload.phone_number),
    name: str(payload.name),
    signInProvider: str(firebase.sign_in_provider),
    secondFactor: str(firebase.sign_in_second_factor),
  };
}

/**
 * Development and tests only: the Firebase Auth emulator signs nothing (`alg: none`).
 * Same issuer, audience, expiry and claim checks, no signature. Config refuses it in production.
 */
export class EmulatorTokenVerifier implements TokenVerifier {
  constructor(private readonly projectId: string) {}

  async verify(token: string): Promise<VerifiedIdentity> {
    let payload: JWTPayload;
    try {
      ({ payload } = UnsecuredJWT.decode(token, {
        issuer: `https://securetoken.google.com/${this.projectId}`,
        audience: this.projectId,
        clockTolerance: CLOCK_TOLERANCE_S,
        requiredClaims: ["sub", "iat", "exp", "auth_time"],
      }));
    } catch (err) {
      if (err instanceof joseErrors.JWTExpired) throw new ProblemError(401, "token_expired", "the sign-in token has expired");
      throw new ProblemError(401, "token_invalid", "the sign-in token is not valid");
    }
    return identityFrom(payload);
  }
}

/** Used when FIREBASE_PROJECT_ID is not configured (local dev): every protected route answers 401. */
export class DisabledTokenVerifier implements TokenVerifier {
  async verify(): Promise<VerifiedIdentity> {
    throw new ProblemError(401, "auth_not_configured", "sign-in is not configured on this server (FIREBASE_PROJECT_ID)");
  }
}

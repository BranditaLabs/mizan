import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { ProblemError } from "../src/platform/http/problem.js";
import { DisabledTokenVerifier, FirebaseTokenVerifier } from "../src/platform/auth/token-verifier.js";

const PROJECT = "mizan-test";
let sign: (claims?: Record<string, unknown>, opts?: { alg?: string; key?: CryptoKey; kid?: string; iss?: string; aud?: string; exp?: number; sub?: string }) => Promise<string>;
let verifier: FirebaseTokenVerifier;
let otherKey: CryptoKey;

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  otherKey = (await generateKeyPair("RS256")).privateKey;
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  verifier = new FirebaseTokenVerifier(PROJECT, createLocalJWKSet({ keys: [jwk] }));
  const now = Math.floor(Date.now() / 1000);
  sign = (claims = {}, o = {}) =>
    new SignJWT({ auth_time: now - 60, firebase: { sign_in_provider: "phone" }, ...claims })
      .setProtectedHeader({ alg: o.alg ?? "RS256", kid: o.kid ?? "k1" })
      .setIssuer(o.iss ?? `https://securetoken.google.com/${PROJECT}`)
      .setAudience(o.aud ?? PROJECT)
      .setSubject(o.sub ?? "fb-uid-1")
      .setIssuedAt(now - 60)
      .setExpirationTime(o.exp ?? now + 3600)
      .sign(o.key ?? privateKey);
});

const code = async (p: Promise<unknown>) => {
  try { await p; return "ok"; } catch (e) { return e instanceof ProblemError ? `${e.status} ${e.code}` : String(e); }
};

describe("FirebaseTokenVerifier", () => {
  it("accepts a valid token and maps the claims", async () => {
    const token = await sign({ email: "sara@example.com", email_verified: true, phone_number: "+201001234821", name: "Sara",
      firebase: { sign_in_provider: "phone", sign_in_second_factor: "totp" } });
    expect(await verifier.verify(token)).toEqual({
      uid: "fb-uid-1", email: "sara@example.com", emailVerified: true, phone: "+201001234821", name: "Sara",
      signInProvider: "phone", secondFactor: "totp",
    });
  });

  it.each([
    ["another project (audience)", { aud: "someone-else" }],
    ["another issuer", { iss: "https://securetoken.google.com/someone-else" }],
    ["an unknown signing key", { kid: "k1", key: undefined as unknown as CryptoKey, other: true }],
    ["an unknown key id", { kid: "nope" }],
    ["an empty subject", { sub: "" }],
  ])("rejects a token from %s", async (_label, o) => {
    const opts = { ...o, ...("other" in o ? { key: otherKey } : {}) };
    expect(await code(verifier.verify(await sign({}, opts)))).toBe("401 token_invalid");
  });

  it("reports expiry separately", async () => {
    expect(await code(verifier.verify(await sign({}, { exp: Math.floor(Date.now() / 1000) - 3600 })))).toBe("401 token_expired");
  });

  it("rejects auth_time in the future and a missing auth_time", async () => {
    expect(await code(verifier.verify(await sign({ auth_time: Math.floor(Date.now() / 1000) + 3600 })))).toBe("401 token_invalid");
    expect(await code(verifier.verify(await sign({ auth_time: undefined })))).toBe("401 token_invalid");
  });

  it("rejects unsigned, HMAC and garbage tokens", async () => {
    const [h, p] = (await sign()).split(".");
    const none = `${Buffer.from(JSON.stringify({ alg: "none", kid: "k1" })).toString("base64url")}.${p}.`;
    expect(await code(verifier.verify(none))).toBe("401 token_invalid");
    expect(await code(verifier.verify(`${h}.${p}.c2lnbmF0dXJl`))).toBe("401 token_invalid");
    expect(await code(verifier.verify("not-a-jwt"))).toBe("401 token_invalid");
  });
});

describe("DisabledTokenVerifier", () => {
  it("answers 401 auth_not_configured", async () => {
    expect(await code(new DisabledTokenVerifier().verify())).toBe("401 auth_not_configured");
  });
});

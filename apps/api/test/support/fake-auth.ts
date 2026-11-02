import { ProblemError } from "../../src/platform/http/problem.js";
import type { TokenVerifier, VerifiedIdentity } from "../../src/platform/auth/token-verifier.js";

/** Token → identity table standing in for Firebase. Unknown tokens are invalid. */
export class FakeVerifier implements TokenVerifier {
  readonly identities = new Map<string, VerifiedIdentity>();

  add(token: string, identity: Partial<VerifiedIdentity> & { uid: string }): string {
    this.identities.set(token, { emailVerified: false, ...identity });
    return token;
  }

  async verify(token: string): Promise<VerifiedIdentity> {
    const id = this.identities.get(token);
    if (!id) throw new ProblemError(401, "token_invalid", "the sign-in token is not valid");
    return id;
  }
}

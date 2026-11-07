import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearAuthMemory, draft, lastMethod, signupIntent } from "../src/lib/auth/intent";

class Mem {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}
const g = globalThis as unknown as { window?: unknown };
let session: Mem;
let local: Mem;
beforeEach(() => { session = new Mem(); local = new Mem(); g.window = { sessionStorage: session, localStorage: local }; });
afterEach(() => { delete g.window; });

describe("sign-up intent (this tab only, no personal data)", () => {
  it("round-trips and re-validates what it reads", () => {
    signupIntent.save("scale", "year", false, 1000);
    expect(signupIntent.read(2000)).toMatchObject({ plan: "scale", interval: "year", enterprise: false });
    session.setItem("mizan.signup", JSON.stringify({ v: 1, plan: "gold", interval: "weekly", at: 1000 }));
    expect(signupIntent.read(2000)).toMatchObject({ plan: "growth", interval: "month" });
  });
  it("expires after 24 hours and drops what it cannot read", () => {
    signupIntent.save("scale", "year", false, 0);
    expect(signupIntent.read(24 * 3600 * 1000 + 1)).toBeNull();
    expect(session.getItem("mizan.signup")).toBeNull();
    session.setItem("mizan.signup", "{not json");
    expect(signupIntent.read()).toBeNull();
  });
  it("survives storage being off", () => {
    g.window = { get sessionStorage(): Storage { throw new Error("blocked"); }, get localStorage(): Storage { throw new Error("blocked"); } };
    expect(() => signupIntent.save("growth", "month")).not.toThrow();
    expect(signupIntent.read()).toBeNull();
    expect(lastMethod.read()).toBeNull();
  });
  it("the draft keeps the email and method only", () => {
    draft.save({ email: "a@b.co", method: "phone" });
    expect(draft.read()).toEqual({ email: "a@b.co", method: "phone" });
    session.setItem("mizan.auth.draft", JSON.stringify({ email: 5, method: "fax", password: "x" }));
    expect(draft.read()).toEqual({ email: undefined, method: undefined });
  });
  it("sign-out and a created store clear it all", () => {
    signupIntent.save("scale", "year");
    draft.save({ email: "a@b.co" });
    session.setItem("mizan.resume", "/x");
    clearAuthMemory();
    expect([...session.m.keys()]).toEqual([]);
  });
});

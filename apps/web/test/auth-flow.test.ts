import { describe, expect, it } from "vitest";
import { CODE_STEPS, flow, focusFor, initialFlow, type FlowState } from "../src/lib/auth/flow";

const at = (s: FlowState) => [s.step, s.direction];

describe("sign-in flow reducer", () => {
  it("starts on the method and mode it is given", () => {
    expect(initialFlow({ mode: "create", method: "phone" })).toMatchObject({ step: "start", mode: "create", method: "phone" });
  });
  it("method and mode swap in place, only on the start step", () => {
    let s = initialFlow();
    s = flow(s, { type: "method", method: "phone" });
    expect(at(s)).toEqual(["start", "swap"]);
    s = flow(s, { type: "mode", mode: "create" });
    expect(s).toMatchObject({ mode: "create", direction: "swap" });
    const code = flow(s, { type: "go", step: "phoneCode" });
    expect(flow(code, { type: "method", method: "email" })).toBe(code);
  });
  it("forward and back keep a history", () => {
    let s = flow(initialFlow(), { type: "go", step: "sso" });
    expect(at(s)).toEqual(["sso", "forward"]);
    s = flow(s, { type: "back" });
    expect(at(s)).toEqual(["start", "back"]);
    expect(flow(s, { type: "back" })).toBe(s);
  });
  it("reset → resetSent replaces the form: back goes to the start", () => {
    let s = flow(initialFlow(), { type: "go", step: "reset" });
    s = flow(s, { type: "go", step: "resetSent" });
    expect(s.history).toEqual(["start"]);
    expect(flow(s, { type: "back" }).step).toBe("start");
  });
  it("restart and done", () => {
    const mfa = flow(initialFlow(), { type: "go", step: "mfa" });
    expect(at(flow(mfa, { type: "restart" }))).toEqual(["start", "back"]);
    const done = flow(mfa, { type: "done" });
    expect(at(done)).toEqual(["done", "forward"]);
    expect(flow(done, { type: "go", step: "sso" })).toBe(done);
    expect(flow(done, { type: "back" })).toBe(done);
  });
  it("focus per step, and which steps lock the language", () => {
    expect(focusFor("start")).toBe("field");
    expect(focusFor("mfa")).toBe("code");
    expect(focusFor("phoneCode")).toBe("code");
    expect(focusFor("resetSent")).toBe("heading");
    expect([...CODE_STEPS].sort()).toEqual(["mfa", "phoneCode"]);
  });
});

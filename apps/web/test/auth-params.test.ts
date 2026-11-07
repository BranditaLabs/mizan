import { describe, expect, it } from "vitest";
import { carriedQuery, parseAuthParams, parseInterval, parseInvite, parsePlan, reasonFromNext } from "../src/lib/auth/params";
import { safeNext } from "../src/lib/next-path";

describe("safeNext: control characters and backslashes never reach a redirect", () => {
  it.each(["/\t/evil.example", "/\n/evil.example", "/\u0085x", "/x\u0000", "/\\evil.example", "//evil.example", "/%5Cevil.example", "/%09/evil.example", "/%2F/evil.example", "/%E0%A4%A"])(
    "%j → /", (bad) => expect(safeNext(bad)).toBe("/"));
  it("keeps real paths, query included", () => {
    expect(safeNext("/welcome?invite=0b1c2d3e-0000-4000-8000-000000000000")).toBe("/welcome?invite=0b1c2d3e-0000-4000-8000-000000000000");
    expect(safeNext("/integrations/shopify/connect?install=abc&shop=nile.myshopify.com")).toBe("/integrations/shopify/connect?install=abc&shop=nile.myshopify.com");
  });
});

describe("sign-in params: allow-listed, mapped to enums, never echoed", () => {
  it("plan: growth and scale; enterprise becomes Scale with a flag; anything else is Growth", () => {
    expect(parsePlan("SCALE")).toEqual({ plan: "scale", enterprise: false });
    expect(parsePlan("enterprise")).toEqual({ plan: "scale", enterprise: true });
    for (const bad of ["free", "gold", "<script>", "", undefined]) expect(parsePlan(bad)).toEqual({ plan: "growth", enterprise: false });
  });
  it("billing spellings", () => {
    for (const y of ["yearly", "year", "annual", "ANNUAL", "annually"]) expect(parseInterval(y)).toBe("year");
    for (const m of ["monthly", "month", "weekly", "", undefined]) expect(parseInterval(m)).toBe("month");
  });
  it("reasons: four from the query, the rest only from next", () => {
    expect(parseAuthParams({ reason: "expired" }).reason).toBe("expired");
    expect(parseAuthParams({ reason: "<script>" }).reason).toBeNull();
    expect(parseAuthParams({ reason: "invite" }).reason).toBeNull();
    expect(parseAuthParams({ next: "/welcome?invite=x" }).reason).toBe("invite");
    expect(parseAuthParams({ next: "/security/two-step" }).reason).toBe("twoStep");
  });
  it("a Shopify shop is named only when it is a real *.myshopify.com", () => {
    expect(reasonFromNext("/integrations/shopify/connect?shop=nile-abayas.myshopify.com")).toEqual({ reason: "shopify", shop: "nile-abayas.myshopify.com" });
    expect(reasonFromNext("/integrations/shopify/connect?shop=<b>x</b>")).toEqual({ reason: "shopifyGeneric", shop: null });
  });
  it("mode, enrolled and next", () => {
    const p = parseAuthParams({ mode: "signup", enrolled: "1", next: "//evil", plan: "scale", billing: "annual" });
    expect(p).toMatchObject({ mode: "create", enrolled: true, next: "/", plan: "scale", interval: "year" });
    expect(parseAuthParams({}).mode).toBe("signin");
  });
  it("invite: a strict uuid or the unknown sentinel", () => {
    expect(parseInvite("0B1C2D3E-0000-4000-8000-000000000000")).toBe("0b1c2d3e-0000-4000-8000-000000000000");
    expect(parseInvite("unknown")).toBe("unknown");
    expect(parseInvite("not-a-uuid")).toBeNull();
  });
});

describe("the language link carries the allow-listed query only, re-serialised", () => {
  it("keeps next, mode, plan, billing; drops the rest", () => {
    expect(carriedQuery("?mode=signup&next=%2Fwelcome&plan=scale&x=1")).toBe("?next=%2Fwelcome&mode=signup&plan=scale");
    expect(carriedQuery("?billing=annual")).toBe("?billing=yearly");
    expect(carriedQuery("?plan=<script>&reason=<img>")).toBe("?plan=growth");
    expect(carriedQuery("?next=//evil.example")).toBe("");
    expect(carriedQuery("?email=a%40b.com&phone=0100")).toBe("");
  });
});

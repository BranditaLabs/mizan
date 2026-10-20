import { describe, expect, it } from "vitest";
import { maskPhone, REDACTED, redactDeep, scrubText, scrubUrl } from "../src/platform/logging/redact.js";

describe("scrubText", () => {
  it.each([
    ["call 01001234821 now", "call 010•••4821 now"],
    ["call +20 100 123 4821", "call 010•••4821"],
    ["رقم العميل ٠١٠٠١٢٣٤٨٢١", "رقم العميل 010•••4821"],
    ["KSA +966 50 123 4567", "KSA 050•••4567"],
    ["UAE 00971501234567", "UAE 050•••4567"],
  ])("masks phones: %s", (input, out) => expect(scrubText(input)).toBe(out));

  it("masks emails, bearer tokens and provider keys", () => {
    expect(scrubText("from sara@example.com")).toBe("from [redacted-email]");
    expect(scrubText("Authorization: Bearer eyJhbGciOi.abc-def_ghi")).toBe("Authorization: Bearer [redacted]");
    expect(scrubText("token shpat_abc123 and mz_live_XYZ9")).toBe("token [redacted-key] and [redacted-key]");
  });

  it("leaves order numbers, amounts, ids and dates alone", () => {
    const text = "order #100234 total 1150.00 EGP id 3f1c2b7e-0000-4000-8000-000000000001 at 2026-10-20T14:03:00Z";
    expect(scrubText(text)).toBe(text);
  });
});

describe("scrubUrl", () => {
  it("decodes before scrubbing and survives malformed escapes", () => {
    expect(scrubUrl("/v1/orders?q=sara%40example.com&phone=%2B201001234821&status=confirmed"))
      .toBe("/v1/orders?q=[redacted-email]&phone=010•••4821&status=confirmed");
    expect(scrubUrl("/v1/x?q=%E0%A4%A&p=01001234821")).toBe("/v1/x?q=%E0%A4%A&p=010•••4821");
  });
});

describe("redactDeep", () => {
  it("replaces sensitive keys at any depth and scrubs other strings", () => {
    const out = redactDeep({
      orderId: "o_1",
      total: { amount: "1150.00", currency: "EGP" },
      customer: { name: "سارة", phone: "01001234821", email: "s@x.com", note: "call 01001234821" },
      shipping: { address1: "12 Tahrir St", city: "Cairo" },
      headers: { Authorization: "Bearer abc" },
    });
    expect(out).toEqual({
      orderId: "o_1",
      total: { amount: "1150.00", currency: "EGP" },
      customer: { name: REDACTED, phone: REDACTED, email: REDACTED, note: "call 010•••4821" },
      shipping: { address1: REDACTED, city: "Cairo" },
      headers: { Authorization: REDACTED },
    });
  });

  it("handles errors, arrays, cycles and depth", () => {
    const err = new Error("no courier for 01001234821");
    const cyc: Record<string, unknown> = { a: 1 };
    cyc.self = cyc;
    let deep: Record<string, unknown> = { v: 1 };
    for (let i = 0; i < 12; i++) deep = { d: deep };
    expect(redactDeep(err)).toMatchObject({ type: "Error", message: "no courier for 010•••4821" });
    expect(redactDeep(["01001234821", 5, null])).toEqual(["010•••4821", 5, null]);
    expect(redactDeep(cyc)).toEqual({ a: 1, self: "[circular]" });
    expect(JSON.stringify(redactDeep(deep))).toContain("[depth]");
  });

  it("maskPhone", () => {
    expect(maskPhone("01001234821")).toBe("010•••4821");
    expect(maskPhone("123")).toBe("•••");
  });
});

describe("redactLogRecord", () => {
  it("scrubs every field but leaves req/res/err to their serializers, without walking them", async () => {
    const { redactLogRecord } = await import("../src/platform/logging/logger.module.js");
    const req = { get socket(): never { throw new Error("walked the raw request"); } };
    const out = redactLogRecord({ message: "call 01001234821", phone: "+201001234821", nested: { email: "a@b.co" }, req, res: req });
    expect(out.req).toBe(req);
    expect(out.res).toBe(req);
    expect(out).toMatchObject({ message: "call 010•••4821", phone: REDACTED });
    expect(JSON.stringify(out.nested)).not.toContain("a@b.co");
  });
});

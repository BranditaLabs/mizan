import { describe, expect, it } from "vitest";
import { localeFrom, problemTitle } from "../src/platform/i18n/messages.js";

describe("localeFrom", () => {
  it.each([
    [undefined, "ar"], ["", "ar"], ["en", "en"], ["en-US,en;q=0.9", "en"], ["ar-EG", "ar"],
    ["fr-FR, en;q=0.5", "en"], ["fr", "ar"], ["en;q=0.2, ar;q=0.8", "ar"], ["ar;q=0, en", "en"],
  ])("%j → %s", (header, locale) => expect(localeFrom(header)).toBe(locale));
});

describe("problemTitle", () => {
  it("has Arabic and English for known codes", () => {
    expect(problemTitle("not_found", "en")).toBe("Not found");
    expect(problemTitle("not_found", "ar")).toBe("مش موجود");
    expect(problemTitle("made_up", "en")).toBeUndefined();
  });
});

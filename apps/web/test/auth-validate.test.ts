import { describe, expect, it } from "vitest";
import { passwordStrength } from "../src/lib/auth/password-strength";
import { checkCode, checkEmail, checkPassword, checkPhone, emailSuggestion } from "../src/lib/auth/validate";

describe("validation: reward early, punish late", () => {
  it("an empty field is flagged on submit only", () => {
    expect(checkEmail("", "blur")).toBeNull();
    expect(checkEmail(" ", "submit")).toBe("requiredEmail");
    expect(checkPassword("", "blur", false)).toBeNull();
    expect(checkPassword("", "submit", false)).toBe("requiredPassword");
    expect(checkPhone("", "EG", "blur")).toBeNull();
    expect(checkPhone("", "EG", "submit")).toBe("requiredPhone");
  });
  it("formats", () => {
    expect(checkEmail("ahmed@store", "blur")).toBe("invalidEmail");
    expect(checkEmail(" ahmed@store.com ", "submit")).toBeNull();
    expect(checkPhone("0123", "EG", "submit")).toBe("invalidPhone");
    expect(checkPhone("01001234821", "EG", "blur")).toBeNull();
    expect(checkCode("12345")).toBe("codeIncomplete");
    expect(checkCode("123456")).toBeNull();
  });
  it("sign-in never hints at the password rule; a new password needs 8", () => {
    expect(checkPassword("short", "submit", false)).toBeNull();
    expect(checkPassword("short", "blur", true)).toBe("passwordShort");
    expect(checkPassword("long enough", "submit", true)).toBeNull();
  });
  it("offers a fix for a typo in a common domain", () => {
    expect(emailSuggestion("ahmed@gmial.com")).toBe("ahmed@gmail.com");
    expect(emailSuggestion("Sara@hotmal.com")).toBe("Sara@hotmail.com");
    expect(emailSuggestion("ahmed@gmail.com")).toBeNull();
    expect(emailSuggestion("ahmed@nilethreads.com")).toBeNull();
    expect(emailSuggestion("no-at-sign")).toBeNull();
  });
});

describe("password strength", () => {
  it("thresholds", () => {
    expect(passwordStrength("1234567").level).toBe("tooShort");
    expect(passwordStrength("abcdefgh").score).toBe(1);
    expect(passwordStrength("abcdefghijkl").score).toBe(2);
    expect(passwordStrength("Abcdefghijk1").score).toBe(3);
    expect(passwordStrength("Abcdefghijklmno1!").score).toBe(4);
  });
  it("common passwords and phone-like runs lose a point", () => {
    expect(passwordStrength("password123").tip).toBe("common");
    expect(passwordStrength("01001234821").tip).toBe("common");
  });
  it("the email's name or the person's name in it loses a point", () => {
    expect(passwordStrength("ahmedrocks2026", { email: "ahmed@store.com" }).tip).toBe("personal");
    expect(passwordStrength("Sara-Nile-2026", { name: "Sara Mahmoud" }).tip).toBe("personal");
  });
  it("Arabic letters count as a character class", () => {
    expect(passwordStrength("ميزانMizan12").score).toBeGreaterThanOrEqual(3);
  });
});

import { describe, expect, it } from "vitest";
import { consentKeyword } from "../src/modules/confirmation/messages.js";

/** E6-4b: STOP and START typed alone, in Arabic or English, however they are spelled; anything longer is a message. */
describe("consent keywords", () => {
  it("reads STOP and START in both languages", () => {
    for (const t of ["STOP", "stop", " Stop! ", "unsubscribe", "إيقاف", "ايقاف", "وقف", "وقف الرسايل", "إلغاء الاشتراك", "الغاء الاشتراك.", "إِيقاف"]) expect(consentKeyword(t), t).toBe("opt_out");
    for (const t of ["START", "start", "ابدأ", "ابدا", "إبدأ"]) expect(consentKeyword(t), t).toBe("opt_in");
  });
  it("leaves real messages to the team", () => {
    for (const t of ["الغي", "إلغاء", "cancel", "stop calling me", "please stop", "عايز أوقف الأوردر", "ok", ""]) expect(consentKeyword(t), t).toBeNull();
  });
});

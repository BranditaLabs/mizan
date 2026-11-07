/**
 * A small password strength score for the create-account meter (no zxcvbn): length first, then
 * variety, minus common passwords and passwords that contain the email's name or the person's name.
 * The meter only guides; the rule that blocks is 8 characters (and Firebase's own policy).
 */
export type Strength = "tooShort" | "weak" | "ok" | "strong" | "great";

const COMMON = new Set([
  "12345678", "123456789", "1234567890", "87654321", "11111111", "00000000", "12341234", "11223344", "123123123", "1q2w3e4r",
  "password", "password1", "password123", "passw0rd", "p@ssw0rd", "qwertyui", "qwerty123", "qwertyuiop", "asdfghjk", "zxcvbnm1",
  "iloveyou", "sunshine", "princess", "football", "baseball", "welcome1", "welcome123", "letmein1", "admin123", "abc12345",
  "abcd1234", "aa123456", "mizan123", "mizan2026", "brandita", "egypt123", "cairo123", "masr1234", "mohamed1", "mohamed123",
  "ahmed123", "mahmoud1", "mostafa1", "elsayed1", "123qweasd", "qazwsx123", "zaq12wsx", "1qaz2wsx", "superman", "starwars",
  "01000000000", "01111111111", "01234567890", "0123456789", "201000000000", "9876543210", "147258369", "159753123", "741852963", "112233445566",
]);

function classes(pw: string): number {
  let n = 0;
  if (/[a-z]/.test(pw)) n++;
  if (/[A-Z]/.test(pw)) n++;
  if (/\d/.test(pw)) n++;
  if (/[^\p{L}\d]/u.test(pw)) n++;
  if (/[؀-ۿ]/.test(pw)) n++;
  return n;
}

/** Long runs of one digit or a straight sequence look like phone numbers or dates. */
function phoneLike(pw: string): boolean {
  return /^\+?\d{8,}$/.test(pw) && (/^(\d)\1+$/.test(pw) || /^0?1[0125]\d{8}$/.test(pw) || "01234567890123456789".includes(pw) || "98765432109876543210".includes(pw));
}

export function passwordStrength(pw: string, personal: { email?: string | null; name?: string | null } = {}): { level: Strength; score: number; tip: "length" | "common" | "personal" | null } {
  if (pw.length < 8) return { level: "tooShort", score: 0, tip: "length" };
  let score = 1;
  if (pw.length >= 12) score++;
  if (pw.length >= 16) score++;
  if (classes(pw) >= 3) score++;
  const lower = pw.toLowerCase();
  let tip: "length" | "common" | "personal" | null = null;
  if (COMMON.has(lower) || phoneLike(pw)) { score--; tip = "common"; }
  const local = personal.email?.split("@")[0]?.toLowerCase() ?? "";
  const names = (personal.name ?? "").toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
  if ((local.length >= 3 && lower.includes(local)) || names.some((w) => lower.includes(w))) { score--; tip = tip ?? "personal"; }
  score = Math.min(4, Math.max(1, score));
  const level: Strength = score === 1 ? "weak" : score === 2 ? "ok" : score === 3 ? "strong" : "great";
  return { level, score, tip: tip ?? (score < 3 && pw.length < 12 ? "length" : null) };
}

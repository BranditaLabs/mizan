/**
 * Pure helpers behind the one-time-code field (css/auth.css .mz-auth-code, react/auth.tsx CodeField).
 */

/** Arabic-Indic (٠-٩) and Persian (۰-۹) digits → ASCII (same rule as @mizan/shared toAsciiDigits). */
export function asciiDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (d) => {
    const c = d.charCodeAt(0);
    return String(c >= 0x06f0 ? c - 0x06f0 : c - 0x0660);
  });
}

/**
 * What the code field keeps from what was typed or pasted: digits only, at most `length`.
 * A pasted sentence ("Your code is 123456. Don't share it") gives its first run of exactly
 * `length` digits, so a phone number or a date elsewhere in the message is not mixed in.
 */
export function normalizeCode(raw: string, length = 6): string {
  const ascii = asciiDigits(raw);
  const run = new RegExp(`(?:^|\\D)(\\d{${length}})(?!\\d)`).exec(ascii);
  if (run && /\D/.test(ascii)) return run[1]!;
  return ascii.replace(/\D/g, "").slice(0, length);
}

/**
 * Whether a full code should be submitted by itself: complete, not already being checked, and not
 * the exact value that was just refused (a refused code is never resent unchanged).
 */
export function shouldAutoSubmit(code: string, opts: { length?: number; busy: boolean; rejected: string | null }): boolean {
  return code.length === (opts.length ?? 6) && !opts.busy && code !== opts.rejected;
}

/** "m:ss" for a countdown (0:59, 2:00, 5:00). */
export function mmss(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Resend waits grow with each send: 60s, then 120s, then 300s. */
export const RESEND_BACKOFF_S = [60, 120, 300] as const;
export function resendWait(sends: number): number {
  return RESEND_BACKOFF_S[Math.min(Math.max(sends - 1, 0), RESEND_BACKOFF_S.length - 1)]!;
}

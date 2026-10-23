import { z } from "zod";

/**
 * whatsapp: the customer answers with buttons in the chat. call_auto: an automated call (needs a
 * voice vendor, E6-8). call_team: the store's own team calls; it ends the automatic part, so it
 * is always the last step.
 */
export const AUTOMATED_CHANNELS = ["whatsapp", "call_auto", "call_team"] as const;
export type AutomatedChannel = (typeof AUTOMATED_CHANNELS)[number];
/** Channels stored before E6-10: SMS is dropped, an automated "voice" call is call_auto. */
const LEGACY: Record<string, AutomatedChannel | null> = { sms: null, voice: "call_auto" };

const Clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM, 24-hour");

/**
 * A store's confirmation settings (M2, E6-7, E6-10), kept in tenants.settings.confirmation. The
 * cascade tries each step in order and waits `waitMinutes` for an answer before the next; a team
 * call (or nothing left) puts the order on the team's "Needs a call" list. Default: WhatsApp,
 * wait 2 h, then the team calls (up to 3 tries, 1 h apart); calls only 10:00–22:00 store time.
 */
export const ConfirmationSettingsSchema = z.object({
  enabled: z.boolean().describe("Start a confirmation for every new cash-on-delivery order"),
  steps: z.array(z.object({
    channel: z.enum(AUTOMATED_CHANNELS),
    waitMinutes: z.number().int().min(10).max(24 * 60).describe("How long to wait for an answer before the next step"),
  })).min(1).max(6)
    .refine((steps) => steps.findIndex((x) => x.channel === "call_team") === -1 || steps.findIndex((x) => x.channel === "call_team") === steps.length - 1, "the team call is the last step"),
  callingHours: z.object({ start: Clock, end: Clock }).refine((h) => h.start < h.end, "start must be before end"),
  teamCalls: z.object({
    attempts: z.number().int().min(1).max(10).describe("How many times the team tries before the order stays on the list as unreachable"),
    retryMinutes: z.number().int().min(10).max(24 * 60).describe("After \"no answer\", when the order comes back on the list"),
  }),
  linkHours: z.number().int().min(6).max(7 * 24).describe("How long a hand-sent confirm link works"),
});
export type ConfirmationSettings = z.infer<typeof ConfirmationSettingsSchema>;

export const DEFAULT_CONFIRMATION: ConfirmationSettings = {
  enabled: true,
  steps: [
    { channel: "whatsapp", waitMinutes: 120 },
    { channel: "call_team", waitMinutes: 60 },
  ],
  callingHours: { start: "10:00", end: "22:00" },
  teamCalls: { attempts: 3, retryMinutes: 60 },
  linkHours: 72,
};

/** A stored cascade with pre-E6-10 channels read as today's; null when nothing usable is left. */
export function normalizeSteps(steps: unknown): Array<{ channel: AutomatedChannel; waitMinutes: number }> | null {
  if (!Array.isArray(steps)) return null;
  const out: Array<{ channel: AutomatedChannel; waitMinutes: number }> = [];
  for (const s of steps as Array<{ channel?: string; waitMinutes?: number }>) {
    const channel = s?.channel && s.channel in LEGACY ? LEGACY[s.channel] : (AUTOMATED_CHANNELS as readonly string[]).includes(s?.channel ?? "") ? (s.channel as AutomatedChannel) : null;
    if (channel && typeof s.waitMinutes === "number") out.push({ channel, waitMinutes: s.waitMinutes });
  }
  const team = out.findIndex((x) => x.channel === "call_team");
  return out.length ? (team >= 0 ? out.slice(0, team + 1) : out) : null;
}

/** Stored settings over the defaults; a broken stored value never stops orders (defaults win). */
export function confirmationSettings(settings: unknown): ConfirmationSettings {
  const stored = (settings as { confirmation?: Record<string, unknown> } | null)?.confirmation ?? {};
  const { steps: raw, ...rest } = stored;
  const steps = normalizeSteps(raw);
  const parsed = ConfirmationSettingsSchema.partial().safeParse(steps ? { ...rest, steps } : rest);
  return { ...DEFAULT_CONFIRMATION, ...(parsed.success ? parsed.data : {}) };
}

/** Minutes since local midnight in a time zone. */
function localMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}
const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** `at` when it falls inside calling hours (store time), else the next opening. */
export function nextCallingTime(at: Date, hours: ConfirmationSettings["callingHours"], timeZone: string): Date {
  const now = localMinutes(at, timeZone);
  const start = toMinutes(hours.start);
  const end = toMinutes(hours.end);
  if (now >= start && now < end) return at;
  const wait = now < start ? start - now : 24 * 60 - now + start;
  const next = new Date(at.getTime() + wait * 60_000);
  next.setSeconds(0, 0);
  return next;
}

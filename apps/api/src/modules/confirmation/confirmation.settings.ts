import { z } from "zod";

export const AUTOMATED_CHANNELS = ["whatsapp", "sms", "voice"] as const;
export type AutomatedChannel = (typeof AUTOMATED_CHANNELS)[number];

const Clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM, 24-hour");

/**
 * A store's confirmation settings (M2, E6-7), kept in tenants.settings.confirmation. The cascade
 * tries each step in order and waits `waitMinutes` for an answer before the next; when every
 * step is used up, the order goes to an agent. Defaults: WhatsApp 2 h → SMS link 2 h → call 1 h,
 * one more call 1 h; calls only 10:00–22:00 store time.
 */
export const ConfirmationSettingsSchema = z.object({
  enabled: z.boolean().describe("Start a confirmation for every new cash-on-delivery order"),
  steps: z.array(z.object({
    channel: z.enum(AUTOMATED_CHANNELS),
    waitMinutes: z.number().int().min(10).max(24 * 60).describe("How long to wait for an answer before the next step"),
  })).max(6),
  callingHours: z.object({ start: Clock, end: Clock }).refine((h) => h.start < h.end, "start must be before end"),
  linkHours: z.number().int().min(6).max(7 * 24).describe("How long the customer's confirm link works"),
});
export type ConfirmationSettings = z.infer<typeof ConfirmationSettingsSchema>;

export const DEFAULT_CONFIRMATION: ConfirmationSettings = {
  enabled: true,
  steps: [
    { channel: "whatsapp", waitMinutes: 120 },
    { channel: "sms", waitMinutes: 120 },
    { channel: "voice", waitMinutes: 60 },
    { channel: "voice", waitMinutes: 60 },
  ],
  callingHours: { start: "10:00", end: "22:00" },
  linkHours: 72,
};

/** Stored settings over the defaults; a broken stored value never stops orders (defaults win). */
export function confirmationSettings(settings: unknown): ConfirmationSettings {
  const stored = (settings as { confirmation?: unknown } | null)?.confirmation;
  const parsed = ConfirmationSettingsSchema.partial().safeParse(stored ?? {});
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

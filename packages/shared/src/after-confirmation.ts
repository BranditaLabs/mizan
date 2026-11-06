import { z } from "zod";
import { PAYMENT_MODES } from "./model.js";
import { MEMBER_ROLES } from "./roles.js";

/**
 * What happens after confirmation (E6-23a), per outcome: confirmed, changed, cancelled, no
 * answer, opted out. Stored in tenants.settings.afterConfirmation. Every action is off by default,
 * so a store that never opens the screen behaves exactly as before.
 */

/** An order tag: letters and digits in any script, spaces, "-" and "_" (as in Automation Studio). */
export const Tag = z.string().trim().toLowerCase().regex(/^[\p{L}\p{N}][\p{L}\p{N} _-]{0,39}$/u);
const Tags = z.array(Tag).max(5);
const Notify = z.strictObject({
  enabled: z.boolean(),
  roles: z.array(z.enum(MEMBER_ROLES)).min(1).max(7).describe("Who is told, by role (a notice in Mizan)"),
});

/** Rule 13: "unknown" cannot be chosen; cashToCollect still decides at booking. */
export const AUTO_BOOK_MODES = PAYMENT_MODES.filter((m) => m !== "unknown") as Exclude<(typeof PAYMENT_MODES)[number], "unknown">[];
/** The ways an order gets confirmed that may book by themselves; an exchange replacement never does. */
export const AUTO_BOOK_CHANNELS = ["whatsapp", "link", "call_team", "agent", "auto", "voice_ivr", "voice_ai"] as const;
export type AutoBookChannel = (typeof AUTO_BOOK_CHANNELS)[number];

export const AfterConfirmationSchema = z.strictObject({
  confirmed: z.strictObject({
    graceMinutes: z.number().int().min(0).max(120)
      .describe("Keep the order off pick lists and ready-to-ship, and do not auto-book, so the customer can still change or cancel"),
    tags: Tags.describe("In Mizan and, for Shopify orders, in the store"),
    message: z.enum(["short", "summary"]).describe("The WhatsApp thank-you after a tap: the short text, or with the items, the cash to collect and the area"),
    notify: Notify,
    autoBook: z.strictObject({
      enabled: z.boolean(),
      courierConnectionId: z.uuid().nullable().describe("A Bosta connection; null: the first one connected"),
      paymentModes: z.array(z.enum(AUTO_BOOK_MODES as [string, ...string[]])).min(1).max(5),
      channels: z.array(z.enum(AUTO_BOOK_CHANNELS)).min(1).describe("Confirmations that may book by themselves"),
      afterChange: z.boolean().describe("Also auto-book orders whose customer asked for a change before the team confirmed"),
    }),
  }),
  changed: z.strictObject({ tags: Tags, notify: Notify, assignTo: z.uuid().nullable().describe("A team member who takes the call back") }),
  cancelled: z.strictObject({ tags: Tags, notify: Notify }),
  noAnswer: z.strictObject({
    tags: Tags,
    notify: Notify,
    autoCancel: z.strictObject({
      enabled: z.boolean(),
      after: z.enum(["messages", "team_calls"]).describe("messages: the automatic messages went unanswered; team_calls: the team's last call went unanswered"),
      afterHours: z.number().int().min(1).max(72),
      cancelIfAssigned: z.boolean().describe("Also cancel when a team member has taken the order"),
    }),
  }),
  optedOut: z.strictObject({ tags: Tags, notify: Notify }),
});
export type AfterConfirmation = z.infer<typeof AfterConfirmationSchema>;

const OFF = { enabled: false, roles: ["owner", "admin", "ops_manager"] as Array<(typeof MEMBER_ROLES)[number]> };
export const DEFAULT_AFTER: AfterConfirmation = {
  confirmed: {
    graceMinutes: 0, tags: [], message: "short", notify: OFF,
    autoBook: { enabled: false, courierConnectionId: null, paymentModes: ["cod", "partial", "prepaid"], channels: [...AUTO_BOOK_CHANNELS], afterChange: false },
  },
  changed: { tags: [], notify: OFF, assignTo: null },
  cancelled: { tags: [], notify: OFF },
  noAnswer: { tags: [], notify: OFF, autoCancel: { enabled: false, after: "team_calls", afterHours: 24, cancelIfAssigned: false } },
  optedOut: { tags: [], notify: OFF },
};

/** The screen's "Recommended" preset: fills the draft only, never applied by itself. */
export function recommendedAfter(hasBosta: boolean): AfterConfirmation {
  return {
    ...DEFAULT_AFTER,
    confirmed: { ...DEFAULT_AFTER.confirmed, graceMinutes: 30, tags: ["mizan-confirmed"], message: "summary", autoBook: { ...DEFAULT_AFTER.confirmed.autoBook, enabled: hasBosta } },
    cancelled: { ...DEFAULT_AFTER.cancelled, notify: { enabled: true, roles: ["owner"] } },
  };
}

/** The store's settings over the defaults, section by section: a broken section falls back to its default, so orders never stop. */
export function afterConfirmationSettings(settings: unknown): AfterConfirmation {
  const stored = (settings && typeof settings === "object" ? (settings as Record<string, unknown>).afterConfirmation : undefined) as Record<string, unknown> | undefined;
  const out = structuredClone(DEFAULT_AFTER) as Record<keyof AfterConfirmation, unknown>;
  if (!stored || typeof stored !== "object") return out as AfterConfirmation;
  for (const key of Object.keys(DEFAULT_AFTER) as Array<keyof AfterConfirmation>) {
    const r = AfterConfirmationSchema.shape[key].safeParse(stored[key]);
    if (r.success) out[key] = r.data;
  }
  return out as AfterConfirmation;
}

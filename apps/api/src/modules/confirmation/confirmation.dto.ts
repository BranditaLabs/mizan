import { MoneySchema } from "@mizan/shared";
import { z } from "zod";
import { AUTOMATED_CHANNELS, ConfirmationSettingsSchema } from "./confirmation.settings.js";

export const ChannelsSchema = z.object({ whatsapp: z.boolean(), sms: z.boolean(), voice: z.boolean() }).describe("Channels a messaging vendor is connected for");
export const ConfirmationSettingsViewSchema = z.object({ settings: ConfirmationSettingsSchema, channels: ChannelsSchema });

const Reason = z.enum(["changed_mind", "ordered_by_mistake", "found_cheaper", "delivery_too_late", "other"]);

/** The customer's answer on the link page. */
export const PublicAnswerSchema = z.object({
  answer: z.enum(["confirm", "cancel", "change"]),
  reason: Reason.optional().describe("Why they cancel"),
  note: z.string().trim().min(1).max(500).optional().describe("What to change (stored encrypted)"),
  location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).optional().describe("Shared from the phone, for the courier"),
});

export const PublicConfirmationSchema = z.object({
  store: z.string(),
  state: z.enum(["open", "confirmed", "cancelled", "changed", "expired", "closed"]),
  firstName: z.string().nullable(),
  order: z.object({
    number: z.string(),
    items: z.array(z.object({ title: z.string(), quantity: z.number().int() })),
    total: MoneySchema,
    cod: MoneySchema.describe("What the customer pays the courier"),
    city: z.string().nullable(),
  }),
  hasLocation: z.boolean(),
  expiresAt: z.iso.datetime(),
});

export const AgentAnswerSchema = z.object({
  answer: z.enum(["confirm", "cancel"]),
  reason: Reason.optional(),
  note: z.string().trim().min(1).max(500).optional(),
});
export const AnswerResultSchema = z.object({ outcome: z.string() });

export const ConfirmationLinkSchema = z.object({
  url: z.string().describe("The customer's confirm link"),
  expiresAt: z.iso.datetime(),
  whatsappUrl: z.string().nullable().describe("wa.me link with the message, to send by hand"),
});

export const OrderConfirmationSchema = z.object({
  run: z.object({
    id: z.uuid(),
    status: z.enum(["running", "confirmed", "cancelled", "needs_agent", "stopped"]),
    outcome: z.string().nullable(),
    reason: z.string().nullable(),
    answeredChannel: z.string().nullable(),
    plan: z.array(z.object({ channel: z.enum(AUTOMATED_CHANNELS), waitMinutes: z.number().int() })),
    step: z.number().int(),
    startedAt: z.iso.datetime(),
    finishedAt: z.iso.datetime().nullable(),
    linkExpiresAt: z.iso.datetime(),
    next: z.object({ channel: z.string(), kind: z.enum(["send", "timeout"]), at: z.iso.datetime() }).nullable(),
  }).nullable(),
  steps: z.array(z.object({ idx: z.number().int(), channel: z.string(), status: z.string(), at: z.iso.datetime() })),
  attempts: z.array(z.object({ channel: z.string(), outcome: z.string().nullable(), at: z.iso.datetime() })),
  channels: ChannelsSchema,
});

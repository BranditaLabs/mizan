import { MoneySchema } from "@mizan/shared";
import { z } from "zod";
import { OfferViewSchema } from "./offers/offers.dto.js";
import { AUTOMATED_CHANNELS, ConfirmationSettingsSchema } from "./confirmation.settings.js";
import { ANSWER_CHANNELS, ROUTES } from "./analytics.js";

export const ChannelsSchema = z.object({
  whatsapp: z.boolean().describe("The store's WhatsApp number is connected and its template approved"),
  call_auto: z.boolean().describe("A vendor for automated calls is connected"),
  call_team: z.literal(true).describe("The store's team can always call"),
}).describe("Channels the store can use for confirmation");
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
  byCall: z.boolean().optional().describe("Answered on a team call (counts for the call channel)"),
});

export const NoAnswerSchema = z.object({
  attempts: z.number().int().describe("Team calls tried so far"),
  max: z.number().int(),
  after: z.iso.datetime().nullable().describe("When the order comes back on the call list; null after the last try"),
  unreachable: z.boolean(),
});

/** The store's WhatsApp number, from Meta (WhatsApp Manager / the app's WhatsApp → API setup). */
export const WhatsAppConnectSchema = z.strictObject({
  phoneNumberId: z.string().trim().regex(/^\d{6,20}$/, "the number's id from Meta (digits), not the phone number").describe("Phone number ID (not the phone number)"),
  wabaId: z.string().trim().regex(/^\d{6,20}$/, "the WhatsApp Business Account id (digits)").describe("WhatsApp Business Account ID"),
  accessToken: z.string().trim().min(20).max(1024).describe("A permanent system-user token with whatsapp_business_messaging and whatsapp_business_management; stored encrypted, never shown again"),
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
    calls: z.object({ attempts: z.number().int(), max: z.number().int(), after: z.iso.datetime().nullable().describe("Back on the call list at") }),
  }).nullable(),
  steps: z.array(z.object({ idx: z.number().int(), channel: z.string(), status: z.string(), at: z.iso.datetime() })),
  attempts: z.array(z.object({ channel: z.string(), outcome: z.string().nullable(), at: z.iso.datetime() })),
  /** The WhatsApp conversation: what was sent, delivered and read, and what the customer tapped (no message text). */
  whatsapp: z.array(z.object({
    direction: z.enum(["in", "out"]),
    kind: z.string().describe("out: template, list, text; in: quick_reply, button_reply, list_reply, text, location"),
    action: z.string().nullable().describe("out: ask or the reply sent; in: confirm, change, cancel, reason, keep, note, message, late, ignored"),
    status: z.string(),
    errorCode: z.number().int().nullable(),
    at: z.iso.datetime(),
  })),
  /** Lines for the team to read on the call while the order is open. */
  script: z.array(z.string()),
  /** The run's offer (E6-11), whatever its status. */
  offer: OfferViewSchema.nullable(),
  channels: ChannelsSchema,
});

/** E6-6: how confirmation went in a period, by route and by the channel that got the answer. */
export const ConfirmationSummaryQuerySchema = z.object({
  days: z.coerce.number().int().refine((v) => [7, 30, 90].includes(v), "7, 30 or 90").default(30).describe("Orders placed in the last 7, 30 or 90 days"),
});
const Rate = z.string().regex(/^\d{1,3}\.\d$/).nullable().describe("Confirmed ÷ (confirmed + cancelled), percent with one decimal; null before anything is decided");
const Counts = {
  orders: z.number().int().describe("Orders that went through confirmation"),
  confirmed: z.number().int().describe("Confirmed (including those shipped or delivered since)"),
  cancelled: z.number().int(),
  pending: z.number().int().describe("Not answered yet"),
};
export const ConfirmationSummarySchema = z.object({
  days: z.number().int(),
  ...Counts,
  rate: Rate,
  needsTeam: z.number().int().describe("Waiting on the team: a team call, a change, a refusal, a hold"),
  medianMinutes: z.number().int().nullable().describe("Median minutes from the order to its confirmation, for orders that were asked (auto-confirmed left out)"),
  byRoute: z.array(z.object({ route: z.enum(ROUTES), ...Counts, rate: Rate })).describe("By route (E6-2); with routing off every order is bot (the cascade)"),
  byChannel: z.array(z.object({ channel: z.enum(ANSWER_CHANNELS), confirmed: z.number().int(), cancelled: z.number().int() }))
    .describe("Who got the answer; store = decided outside confirmation (cancelled in the store, for example)"),
});

/** E6-3: the team's call queue. */
export const CallQueueSchema = z.object({
  waiting: z.number().int().describe("Due now: mine and nobody's"),
  mine: z.number().int().describe("Due now and already mine"),
  later: z.number().int().describe("Called, no answer: waiting for the retry time"),
  nextAt: z.iso.datetime().nullable().describe("The next retry time"),
  unreachable: z.number().int().describe("Every try used; still on the list"),
});
export const CallQueueNextSchema = z.object({
  order: z.object({ id: z.uuid(), number: z.string(), attempts: z.number().int(), unreachable: z.boolean() }).nullable().describe("Claimed for the caller (assigned to them); null when nothing is due"),
});

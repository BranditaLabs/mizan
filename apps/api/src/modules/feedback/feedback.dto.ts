import { z } from "zod";

export const FEEDBACK_KINDS = ["idea", "problem", "question"] as const;
export const FEEDBACK_STATUSES = ["new", "seen", "done"] as const;

/**
 * The screen a person was on, as a path only: a full URL loses its origin, and a query string or
 * fragment is dropped (it can carry a phone, an order id or a token). Control characters go too.
 */
export function pagePath(raw: string): string {
  let p = raw.trim();
  const scheme = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i.exec(p);
  if (scheme) p = p.slice(scheme[0].length);
  p = p.split(/[?#]/, 1)[0] ?? "";
  // eslint-disable-next-line no-control-regex
  p = p.replace(/[\u0000-\u001f\u007f]/g, "");
  if (!p.startsWith("/")) p = `/${p}`;
  return p.slice(0, 300);
}

export const SendFeedbackSchema = z.strictObject({
  kind: z.enum(FEEDBACK_KINDS),
  message: z.string().trim().min(1).max(2000),
  page: z.string().max(2000).default("/").transform(pagePath)
    .describe("The screen it was sent from; only the path is kept (query string and fragment dropped, at most 300 characters)"),
});
export const FeedbackCreatedSchema = z.object({ id: z.uuid() });

export const FeedbackQuerySchema = z.object({
  status: z.enum(FEEDBACK_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});
const Feedback = z.object({
  id: z.uuid(),
  kind: z.enum(FEEDBACK_KINDS),
  message: z.string(),
  page: z.string(),
  locale: z.enum(["ar", "en"]),
  status: z.enum(FEEDBACK_STATUSES),
  store: z.object({ id: z.uuid(), name: z.string() }),
  person: z.object({ id: z.uuid(), name: z.string().nullable(), email: z.string().nullable() }).nullable().describe("Who sent it; null once their account is gone"),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const FeedbackItemSchema = Feedback;
export const FeedbackPageSchema = z.object({ data: z.array(Feedback).describe("Newest first"), total: z.number().int(), nextOffset: z.number().int().nullable() });
export const UpdateFeedbackSchema = z.strictObject({ status: z.enum(FEEDBACK_STATUSES) });
